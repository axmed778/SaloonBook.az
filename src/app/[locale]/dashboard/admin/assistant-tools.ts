import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bakuDayBoundsUtc, bakuToday, bakuYmd } from "@/lib/time";
import { effectivePlan, subscriptionWindow } from "@/lib/subscription";
import { MAX_NOTIFICATION_ATTEMPTS } from "@/lib/queue";
import { readWorkerHeartbeat } from "@/lib/worker-heartbeat";
import {
  accountIdInput,
  auditLogInput,
  listAccountsInput,
  listPaymentsInput,
  parseProposal,
  proposalKindOf,
  type Proposal,
} from "@/lib/admin-assistant/tools";
import { getAccountDetails } from "./actions";

// Runs the admin assistant's tool calls (see src/lib/admin-assistant/tools.ts).
// Read tools query the database directly; propose_* tools only validate and
// return a Proposal for the browser to show. Nothing here writes.
//
// Only reachable from askAssistant, which has already checked the admin session.

export type ToolOutcome =
  | { kind: "result"; content: string; isError?: boolean }
  | { kind: "proposal"; proposal: Proposal; content: string };

const azn = (minor: number) => Math.round(minor) / 100;
const day = (d: Date | null | undefined) => (d ? bakuYmd(d) : null);
const json = (value: unknown): ToolOutcome => ({
  kind: "result",
  content: JSON.stringify(value),
});
const fail = (message: string): ToolOutcome => ({
  kind: "result",
  content: message,
  isError: true,
});

export async function runAssistantTool(
  name: string,
  input: unknown,
): Promise<ToolOutcome> {
  const kind = proposalKindOf(name);
  if (kind) return propose(kind, input);
  switch (name) {
    case "list_accounts":
      return listAccounts(input);
    case "get_account_details":
      return accountDetails(input);
    case "list_payments":
      return listPayments(input);
    case "get_platform_health":
      return platformHealth();
    case "list_audit_log":
      return auditLog(input);
    default:
      return fail(`Unknown tool: ${name}`);
  }
}

async function listAccounts(input: unknown): Promise<ToolOutcome> {
  const parsed = listAccountsInput.safeParse(input ?? {});
  if (!parsed.success) return fail("Invalid input.");
  const q = parsed.data.search?.toLowerCase() ?? "";
  const periodYm = bakuToday().slice(0, 7);

  const [accounts, usage, paid] = await Promise.all([
    prisma.account.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        subscription: {
          select: {
            id: true,
            plan: true,
            status: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            extraBranches: true,
          },
        },
        salons: {
          where: { status: { not: "DELETED" } },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, slug: true },
        },
        memberships: {
          select: {
            role: true,
            user: { select: { email: true, lastLoginAt: true } },
          },
        },
      },
    }),
    prisma.usageCounter.findMany({
      where: { periodYm },
      select: { salonId: true, bookings: true },
    }),
    prisma.payment.groupBy({
      by: ["subscriptionId"],
      _sum: { amountMinor: true },
      _max: { paidAt: true },
    }),
  ]);
  const bookingsBySalon = new Map(usage.map((u) => [u.salonId, u.bookings]));
  const paidBySub = new Map(paid.map((p) => [p.subscriptionId, p]));

  const rows = accounts.map((a) => {
    const sub = a.subscription;
    const window = subscriptionWindow(sub ?? null);
    const lastLogin = a.memberships.reduce<Date | null>((latest, m) => {
      const at = m.user.lastLoginAt;
      return at && (!latest || at > latest) ? at : latest;
    }, null);
    const p = sub ? paidBySub.get(sub.id) : undefined;
    return {
      accountId: a.id,
      accountName: a.name,
      accountStatus: a.status,
      salons: a.salons.map((s) => s.name),
      slug: a.salons[0]?.slug ?? null,
      ownerEmail:
        a.memberships.find((m) => m.role === "OWNER")?.user.email ?? null,
      plan: sub?.plan ?? "FREE",
      effectivePlan: effectivePlan(sub ?? null),
      status: sub?.status ?? null,
      trialEndsAt: day(sub?.trialEndsAt),
      paidUntil: day(sub?.currentPeriodEnd),
      daysLeft: window.daysLeft,
      inGrace: window.inGrace,
      extraBranches: sub?.extraBranches ?? 0,
      bookingsThisMonth: a.salons.reduce(
        (n, s) => n + (bookingsBySalon.get(s.id) ?? 0),
        0,
      ),
      totalPaidAzn: azn(p?._sum.amountMinor ?? 0),
      lastPaymentAt: day(p?._max.paidAt),
      lastLoginAt: day(lastLogin),
      createdAt: day(a.createdAt),
    };
  });

  const matches = q
    ? rows.filter(
        (r) =>
          r.accountName.toLowerCase().includes(q) ||
          r.salons.some((s) => s.toLowerCase().includes(q)) ||
          (r.slug ?? "").toLowerCase().includes(q) ||
          (r.ownerEmail ?? "").toLowerCase().includes(q),
      )
    : rows;
  return json({ today: bakuToday(), count: matches.length, accounts: matches });
}

async function accountDetails(input: unknown): Promise<ToolOutcome> {
  const parsed = accountIdInput.safeParse(input);
  if (!parsed.success)
    return fail("accountId must be a UUID from list_accounts.");
  const res = await getAccountDetails(parsed.data);
  return res.ok ? json(res.details) : fail(res.error);
}

async function listPayments(input: unknown): Promise<ToolOutcome> {
  const parsed = listPaymentsInput.safeParse(input ?? {});
  if (!parsed.success)
    return fail("Invalid input: dates are YYYY-MM-DD, accountId a UUID.");
  const d = parsed.data;
  const paidAt: Prisma.DateTimeFilter = {};
  if (d.from) paidAt.gte = bakuDayBoundsUtc(d.from).startUtc;
  if (d.to) paidAt.lt = bakuDayBoundsUtc(d.to).endUtc;

  const payments = await prisma.payment.findMany({
    where: {
      ...(d.from || d.to ? { paidAt } : {}),
      ...(d.accountId ? { subscription: { accountId: d.accountId } } : {}),
    },
    orderBy: { paidAt: "desc" },
    take: 500,
    select: {
      amountMinor: true,
      periodMonths: true,
      purpose: true,
      method: true,
      paidAt: true,
      subscription: {
        select: {
          accountId: true,
          account: {
            select: { name: true, salons: { take: 1, select: { name: true } } },
          },
        },
      },
    },
  });
  const totalMinor = payments.reduce((n, p) => n + p.amountMinor, 0);
  return json({
    count: payments.length,
    totalAzn: azn(totalMinor),
    payments: payments.map((p) => ({
      date: day(p.paidAt),
      accountId: p.subscription.accountId,
      salon:
        p.subscription.account.salons[0]?.name ?? p.subscription.account.name,
      amountAzn: azn(p.amountMinor),
      months: p.periodMonths,
      purpose: p.purpose,
      method: p.method,
    })),
  });
}

async function platformHealth(): Promise<ToolOutcome> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const [worker, byStatus, deadLetters, subs, accounts] = await Promise.all([
    readWorkerHeartbeat(),
    prisma.notification.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.notification.count({
      where: { status: "FAILED", attempts: { gte: MAX_NOTIFICATION_ATTEMPTS } },
    }),
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.account.count(),
  ]);
  return json({
    worker,
    notificationsLast7Days: Object.fromEntries(
      byStatus.map((r) => [r.status, r._count._all]),
    ),
    undeliverableNotifications: deadLetters,
    accounts,
    subscriptionsByStatus: Object.fromEntries(
      subs.map((r) => [r.status, r._count._all]),
    ),
  });
}

async function auditLog(input: unknown): Promise<ToolOutcome> {
  const parsed = auditLogInput.safeParse(input ?? {});
  if (!parsed.success) return fail("Invalid input.");
  const rows = await prisma.auditLog.findMany({
    where: parsed.data.accountId ? { accountId: parsed.data.accountId } : {},
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit ?? 30,
    select: {
      action: true,
      accountId: true,
      target: true,
      meta: true,
      createdAt: true,
    },
  });
  return json(
    rows.map((r) => ({
      at: r.createdAt.toISOString(),
      action: r.action,
      accountId: r.accountId,
      target: r.target,
      meta: r.meta,
    })),
  );
}

async function propose(
  kind: Proposal["kind"],
  input: unknown,
): Promise<ToolOutcome> {
  const parsed = parseProposal(kind, input);
  if (!parsed.ok) return fail(`Invalid proposal: ${parsed.error}`);
  const args = parsed.args;

  // The card shows the salon's name as stored, so a wrong id is visible to the
  // admin before they confirm, whatever Claude wrote in its answer.
  let salonName: string | null;
  if ("salonId" in args) {
    const salon = await prisma.salon.findUnique({
      where: { id: args.salonId },
      select: { name: true },
    });
    salonName = salon?.name ?? null;
  } else {
    const account = await prisma.account.findUnique({
      where: { id: args.accountId },
      select: {
        name: true,
        salons: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { name: true },
        },
      },
    });
    salonName = account ? (account.salons[0]?.name ?? account.name) : null;
  }
  if (!salonName)
    return fail(
      "No salon or account with that id. Look it up with list_accounts first.",
    );

  const proposal = {
    id: randomUUID(),
    kind,
    args,
    salonName,
    reason: parsed.reason,
  } as Proposal;
  return {
    kind: "proposal",
    proposal,
    content:
      "Shown to the admin as a card. Nothing has changed yet: it runs only if they press Confirm. Tell them it is waiting for their confirmation.",
  };
}
