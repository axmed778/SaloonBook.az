// Owner-side tool: delete a salon account completely — every branch, its
// bookings, clients, payments, staff logins, the subscription, and the owner's
// login — so the email (and the salon's link) can be registered again from
// scratch. This CANNOT be undone; take a Neon branch/snapshot first if in doubt.
// The same delete is in the admin panel (behind the admin's password); what is
// removed and what is kept is described in src/lib/account-deletion.ts.
//
// Usage (run against whichever DB DATABASE_URL points at):
//   npx tsx scripts/delete-account.ts <owner-email | salon-slug>          # dry run
//   npx tsx scripts/delete-account.ts <owner-email | salon-slug> --yes    # delete
//
// The dry run prints exactly what would go and changes nothing. Tables are
// FORCE-RLS, so DATABASE_URL must be a role that bypasses RLS (the Neon owner
// role does; the restricted salonbook_app role does not).
import { prisma } from "../src/lib/prisma";
import { deleteAccountCompletely, planAccountDeletion } from "../src/lib/account-deletion";

async function findAccountId(key: string): Promise<string | null> {
  const k = key.trim().toLowerCase();
  if (k.includes("@")) {
    const owner = await prisma.membership.findFirst({
      where: { role: "OWNER", user: { email: k } },
      select: { accountId: true },
    });
    return owner?.accountId ?? null;
  }
  const salon = await prisma.salon.findUnique({ where: { slug: k }, select: { accountId: true } });
  return salon?.accountId ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--yes");
  const key = args.find((a) => !a.startsWith("--"));
  if (!key) {
    console.error("Usage: npx tsx scripts/delete-account.ts <owner-email | salon-slug> [--yes]");
    process.exitCode = 1;
    return;
  }

  const accountId = await findAccountId(key);
  const plan = accountId ? await planAccountDeletion(accountId) : null;
  if (!plan) {
    console.error(`No account found for '${key}'.`);
    process.exitCode = 1;
    return;
  }

  const c = plan.counts;
  console.log(`Account:       ${plan.name} (${plan.accountId})`);
  console.log(
    `Subscription:  ${plan.subscription ? `${plan.subscription.plan} / ${plan.subscription.status}` : "—"}`,
  );
  console.log(`Branches:      ${plan.salons.map((s) => `${s.name} [/${s.slug}]`).join(", ") || "—"}`);
  console.log(`Appointments:  ${c.appointments}`);
  console.log(`Clients:       ${c.customers}`);
  console.log(`Visit payments:${String(c.visitPayments).padStart(2)}`);
  console.log(`Employees:     ${c.employees}`);
  console.log(`Notifications: ${c.notifications}`);
  console.log(`Logins deleted (email freed): ${plan.deletedEmails.join(", ") || "—"}`);
  if (plan.keptEmails.length > 0) {
    console.log(
      `Logins kept (other account / platform admin), membership removed only: ${plan.keptEmails.join(", ")}`,
    );
  }

  if (!confirm) {
    console.log("\nDry run — nothing deleted. Re-run with --yes to delete all of the above.");
    return;
  }

  await deleteAccountCompletely(plan, { actorUserId: null, via: "scripts/delete-account.ts" });
  console.log("\nDeleted. The email(s) and link(s) above can be registered again.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
