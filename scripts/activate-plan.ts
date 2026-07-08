// Owner-side manual billing tool: mark a salon as paid, or list every
// subscription (the interim "Excel"). Payments are collected personally
// (cash / card-to-card), then the plan is activated here by hand.
//
// Usage (run against whichever DB DATABASE_URL points at):
//   npx tsx scripts/activate-plan.ts --list
//   npx tsx scripts/activate-plan.ts <salon-slug> <BASIC|PRO> [months=1] [amountAZN]
//
// Activation sets Subscription {plan, status: ACTIVE, currentPeriodEnd += months},
// records a Payment row, and writes an AuditLog entry. Extending an already
// ACTIVE sub adds months on top of the current period end (not on today), so
// paying early never loses days.
import { PrismaClient } from "@prisma/client";
import { PLAN_LIMITS } from "../src/lib/plans";
import { addMonths } from "../src/lib/time";

const prisma = new PrismaClient();

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

async function list(): Promise<void> {
  const subs = await prisma.subscription.findMany({
    include: {
      account: { select: { name: true, salons: { select: { slug: true } } } },
      payments: { orderBy: { paidAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });
  if (subs.length === 0) {
    console.log("No subscriptions.");
    return;
  }
  console.log(
    "SLUG".padEnd(22) +
      "ACCOUNT".padEnd(24) +
      "PLAN".padEnd(7) +
      "STATUS".padEnd(17) +
      "TRIAL ENDS".padEnd(12) +
      "PERIOD END".padEnd(12) +
      "LAST PAYMENT",
  );
  for (const s of subs) {
    const slug = s.account.salons[0]?.slug ?? "—";
    const pay = s.payments[0];
    const lastPay = pay ? `${(pay.amountMinor / 100).toFixed(2)} AZN @ ${fmt(pay.paidAt)}` : "—";
    console.log(
      slug.padEnd(22) +
        s.account.name.slice(0, 22).padEnd(24) +
        s.plan.padEnd(7) +
        s.status.padEnd(17) +
        fmt(s.trialEndsAt).padEnd(12) +
        fmt(s.currentPeriodEnd).padEnd(12) +
        lastPay,
    );
  }
}

async function activate(slug: string, planArg: string, monthsArg?: string, amountArg?: string) {
  const plan = planArg.toUpperCase();
  if (plan !== "BASIC" && plan !== "PRO") {
    console.error(`Plan must be BASIC or PRO, got '${planArg}'.`);
    process.exitCode = 1;
    return;
  }
  const months = monthsArg ? Number(monthsArg) : 1;
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    console.error(`Months must be an integer 1..24, got '${monthsArg}'.`);
    process.exitCode = 1;
    return;
  }
  // Default amount = list price × months; override for discounts.
  const amountMinor = amountArg
    ? Math.round(Number(amountArg) * 100)
    : PLAN_LIMITS[plan].priceMinor * months;
  if (!Number.isFinite(amountMinor) || amountMinor < 0) {
    console.error(`Bad amount '${amountArg}'.`);
    process.exitCode = 1;
    return;
  }

  const salon = await prisma.salon.findUnique({
    where: { slug },
    select: {
      name: true,
      account: { select: { id: true, name: true, subscription: true } },
    },
  });
  if (!salon) {
    console.error(`No salon found with slug '${slug}'.`);
    process.exitCode = 1;
    return;
  }
  const sub = salon.account.subscription;
  if (!sub) {
    console.error(`Account '${salon.account.name}' has no subscription row.`);
    process.exitCode = 1;
    return;
  }

  // Extend from the current period end if it's still in the future (early
  // renewal keeps remaining days); otherwise start the period today.
  const now = new Date();
  const base =
    sub.status === "ACTIVE" && sub.currentPeriodEnd && sub.currentPeriodEnd > now
      ? sub.currentPeriodEnd
      : now;
  const periodEnd = addMonths(base, months);

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: sub.id },
      data: { plan, status: "ACTIVE", currentPeriodEnd: periodEnd },
    }),
    prisma.payment.create({
      data: {
        subscriptionId: sub.id,
        amountMinor,
        method: "manual",
        periodMonths: months,
      },
    }),
    prisma.auditLog.create({
      data: {
        accountId: salon.account.id,
        action: "subscription.activate",
        target: sub.id,
        meta: {
          slug,
          plan,
          months,
          amountMinor,
          previousStatus: sub.status,
          previousPlan: sub.plan,
          currentPeriodEnd: periodEnd.toISOString(),
        },
      },
    }),
  ]);

  console.log(
    `✓ '${salon.name}' (${slug}) → ${plan} ACTIVE until ${fmt(periodEnd)} ` +
      `(${months} ay, ${(amountMinor / 100).toFixed(2)} AZN qeydə alındı).`,
  );
}

async function main() {
  const [, , first, ...rest] = process.argv;
  if (!first) {
    console.error(
      "Usage:\n  npx tsx scripts/activate-plan.ts --list\n" +
        "  npx tsx scripts/activate-plan.ts <salon-slug> <BASIC|PRO> [months=1] [amountAZN]",
    );
    process.exitCode = 1;
    return;
  }
  if (first === "--list") {
    await list();
    return;
  }
  const [plan, months, amount] = rest;
  if (!plan) {
    console.error("Missing plan. Usage: activate-plan.ts <salon-slug> <BASIC|PRO> [months] [amountAZN]");
    process.exitCode = 1;
    return;
  }
  await activate(first, plan, months, amount);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
