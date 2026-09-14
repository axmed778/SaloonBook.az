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

const SLUG = "finance-demo";

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

main()
  .catch((e) => {
    console.error(e instanceof Refused ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
