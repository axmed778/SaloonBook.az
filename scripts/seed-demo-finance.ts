/**
 * Demo logins for every role, in a salon of their own: an owner, reception
 * (ADMIN), finance and a master, on an open-ended Pro account so each role can
 * reach everything its row of the permission matrix allows.
 *
 * Its own slug (finance-demo), so it never touches /mysalon or a real salon.
 * Safe to re-run: the account, salon, master and users are found or created, and
 * every run resets the four passwords (ending their sessions) and switches the
 * logins back on.
 *
 * The password comes from the environment, as in prisma/seed.ts: a committed
 * one would be a working login the moment this runs against a real database.
 *
 * Local only. It refuses to run with NODE_ENV=production, or when DATABASE_URL
 * points anywhere but this machine — four known logins on a Pro account are not
 * something to create on Neon by pasting the wrong URL.
 *
 *   $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/salonbook"
 *   $env:DEMO_FINANCE_PASSWORD="…"; corepack pnpm seed:demo-finance
 */
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { hashPassword, passwordIssues } from "../src/lib/auth/password";
import { bakuToday, bakuWallClockToUtc } from "../src/lib/time";
import { LEGAL_DOC_VERSION } from "../src/lib/legal";

const SLUG = "finance-demo";

// The payment demo data. Bookings are found by their service note, so a re-run
// recognises its own rows instead of stacking a second set.
const NOTE_PREFIX = "demo-payment:";
const DEMO_SERVICE = "Demo Xidmət";
const DEMO_PHONE = "+994500000900";
// AppointmentPayment stores actors as id + name with no FK, so a seed row needs
// no User to point at.
const SEED_ACTOR = "seed-demo-finance";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** A refusal whose message is the whole story — printed without a stack. */
class Refused extends Error {}

/**
 * Throws unless this is a development run against a database on this machine.
 *
 * Called after the Prisma client module has loaded, which reads .env into
 * process.env: DATABASE_URL here is the URL the queries below would really use,
 * whether it came from the shell or from .env.
 */
function assertLocalDatabase(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Refused(
      "seed-demo-finance: refusing to run with NODE_ENV=production. It creates four demo " +
        "logins with a known password and is for local development only.",
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Refused(
      "seed-demo-finance: DATABASE_URL is not set. Point it at your local database, e.g. " +
        "postgresql://postgres:postgres@localhost:5432/salonbook",
    );
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Refused("seed-demo-finance: DATABASE_URL is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    // The host only — never the URL, which carries the password.
    throw new Refused(
      `seed-demo-finance: refusing to run against '${host}'. DATABASE_URL must point at a ` +
        `database on this machine (localhost, 127.0.0.1 or ::1); this script is for local ` +
        `development only.`,
    );
  }
}

const LOGINS: {
  email: string;
  fullName: string;
  role: Role;
  /** "branch": works at the demo salon; "account": no home branch (finance). */
  home: "branch" | "account";
  /** The master's login is tied to the demo master. */
  isMaster: boolean;
}[] = [
  { email: "finance-demo+owner@example.com", fullName: "Demo Owner", role: "OWNER", home: "branch", isMaster: false },
  { email: "finance-demo+admin@example.com", fullName: "Demo Reception", role: "ADMIN", home: "branch", isMaster: false },
  { email: "finance-demo+finance@example.com", fullName: "Demo Finance", role: "FINANCE", home: "account", isMaster: false },
  { email: "finance-demo+master@example.com", fullName: "Demo Master", role: "STAFF", home: "branch", isMaster: true },
];

async function main() {
  // Before anything touches the database.
  assertLocalDatabase();

  const password = process.env.DEMO_FINANCE_PASSWORD;
  const issues = password ? passwordIssues(password) : ["not set"];
  if (!password || issues.length > 0) {
    throw new Error(
      `seed-demo-finance: DEMO_FINANCE_PASSWORD is required and must satisfy the password ` +
        `policy (${issues.join(", ")}). Set it in the environment (do not commit it).`,
    );
  }
  const passwordHash = await hashPassword(password);

  let salon = await prisma.salon.findUnique({
    where: { slug: SLUG },
    select: { id: true, accountId: true },
  });
  if (!salon) {
    const account = await prisma.account.create({
      data: {
        name: "Finance Demo",
        subscription: { create: { plan: "PRO", status: "ACTIVE" } },
        salons: { create: { slug: SLUG, name: "Finance Demo" } },
      },
      select: { salons: { select: { id: true, accountId: true } } },
    });
    salon = account.salons[0];
    console.log(`seed-demo-finance: created salon '${SLUG}'.`);
  }
  // ACTIVE with no period end is an open-ended plan (see effectivePlan).
  await prisma.subscription.update({
    where: { accountId: salon.accountId },
    data: { plan: "PRO", status: "ACTIVE", currentPeriodEnd: null },
  });

  const master =
    (await prisma.employee.findFirst({
      where: { salonId: salon.id, name: "Demo Master" },
      select: { id: true },
    })) ??
    (await prisma.employee.create({
      data: { salonId: salon.id, name: "Demo Master", position: "Usta" },
      select: { id: true },
    }));

  // Accept the current legal documents on the demo account's behalf. Without
  // this the dashboard opens behind the re-consent modal, which covers every
  // screen the demo exists to show.
  await prisma.account.update({
    where: { id: salon.accountId },
    data: {
      offerVersion: LEGAL_DOC_VERSION.salonOffer,
      privacyVersion: LEGAL_DOC_VERSION.salonConsents,
    },
  });

  await seedPayments(salon.id, master.id);

  for (const login of LOGINS) {
    const user = await prisma.user.upsert({
      where: { email: login.email },
      update: { passwordHash, sessionsValidFrom: new Date() },
      create: { email: login.email, fullName: login.fullName, passwordHash },
      select: { id: true },
    });
    const placement = {
      role: login.role,
      salonId: login.home === "branch" ? salon.id : null,
      employeeId: login.isMaster ? master.id : null,
      disabledAt: null,
    };
    await prisma.membership.upsert({
      where: { userId_accountId: { userId: user.id, accountId: salon.accountId } },
      update: placement,
      create: { userId: user.id, accountId: salon.accountId, ...placement },
    });
    console.log(`seed-demo-finance: ${login.role.padEnd(7)} ${login.email}`);
  }
}

/**
 * One booking per payment state, so every branch of the popup and the badge is
 * visible without anyone having to type amounts in first: paid in full, paid as
 * a split, partially paid, comped, refunded, voided, and untouched.
 *
 * Re-runnable: the bookings are keyed by their service note, and a run that
 * finds them already there leaves them alone. Dated TODAY and already closed
 * (COMPLETED), so they appear in the Today list, in the day's totals, and — for
 * the ones with money on them — in revenue.
 */
async function seedPayments(salonId: string, employeeId: string): Promise<void> {
  const PRICE = 4500;
  const service =
    (await prisma.service.findFirst({
      where: { salonId, name: DEMO_SERVICE },
      select: { id: true },
    })) ??
    (await prisma.service.create({
      data: { salonId, name: DEMO_SERVICE, priceMinor: PRICE, durationMin: 60 },
      select: { id: true },
    }));
  const customer =
    (await prisma.customer.findFirst({
      where: { salonId, phone: DEMO_PHONE },
      select: { id: true },
    })) ??
    (await prisma.customer.create({
      data: { salonId, name: "Demo Müştəri", phone: DEMO_PHONE },
      select: { id: true },
    }));

  const already = await prisma.appointment.findFirst({
    where: { salonId, serviceNote: NOTE_PREFIX + "paid" },
    select: { id: true },
  });
  if (already) {
    console.log("seed-demo-finance: payment demo bookings already present.");
    return;
  }

  const today = bakuToday();
  const now = new Date();
  let slot = 9 * 60; // 09:00 Baku, one booking an hour

  async function booking(state: string): Promise<string> {
    const startsAt = bakuWallClockToUtc(today, slot);
    const endsAt = bakuWallClockToUtc(today, slot + 60);
    slot += 60;
    const appt = await prisma.appointment.create({
      data: {
        salonId,
        employeeId,
        serviceId: service.id,
        customerId: customer.id,
        startsAt,
        endsAt,
        priceMinor: PRICE,
        status: "COMPLETED",
        source: "DASHBOARD",
        serviceNote: NOTE_PREFIX + state,
      },
      select: { id: true },
    });
    return appt.id;
  }

  const entry = (appointmentId: string, over: Record<string, unknown>) => ({
    salonId,
    appointmentId,
    method: "CASH" as const,
    businessDate: today,
    paidAt: now,
    // Actors are id + name with no FK, so a seed row needs no User behind it.
    createdByUserId: SEED_ACTOR,
    receivedByUserId: SEED_ACTOR,
    receivedByName: "Demo Owner",
    amountMinor: 0,
    discountMinor: 0,
    tipMinor: 0,
    ...over,
  });

  // Paid in full, with a tip on top. The tip is in the day's tip line, not in
  // the cash total, and in no payout base.
  await prisma.appointmentPayment.create({
    data: entry(await booking("paid"), { amountMinor: PRICE, tipMinor: 500 }),
  });

  // Split: part cash, part card. Still "paid".
  const split = await booking("split");
  await prisma.appointmentPayment.createMany({
    data: [
      entry(split, { amountMinor: 2000 }),
      entry(split, { amountMinor: 2500, method: "CARD" }),
    ],
  });

  // Short of the price with no discount to explain it: simply "partial".
  await prisma.appointmentPayment.create({
    data: entry(await booking("partial"), { amountMinor: 2000 }),
  });

  // Fully comped — staff or goodwill. Settled, and worth zero revenue.
  await prisma.appointmentPayment.create({
    data: entry(await booking("comped"), { amountMinor: 0, discountMinor: PRICE }),
  });

  // Paid, then partly handed back. The pair stays visible.
  const refunded = await booking("refunded");
  await prisma.appointmentPayment.createMany({
    data: [
      entry(refunded, { amountMinor: PRICE }),
      entry(refunded, { amountMinor: 1500, kind: "REFUND" }),
    ],
  });

  // Recorded by mistake and undone: struck through in the popup, out of every
  // total, still in the record.
  await prisma.appointmentPayment.create({
    data: entry(await booking("voided"), {
      amountMinor: PRICE,
      voidedAt: now,
      voidedByUserId: SEED_ACTOR,
      voidReason: "Səhvən yazılıb",
    }),
  });

  // Nothing taken at all.
  await booking("unpaid");

  console.log("seed-demo-finance: 7 bookings covering every payment state.");
}

main()
  .catch((e) => {
    console.error(e instanceof Refused ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
