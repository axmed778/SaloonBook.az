// Owner-side tool: delete a salon account completely — every branch, its
// bookings, clients, payments, staff logins, the subscription, and the owner's
// login — so the email (and the salon's link) can be registered again from
// scratch. This CANNOT be undone; take a Neon branch/snapshot first if in doubt.
//
// Usage (run against whichever DB DATABASE_URL points at):
//   npx tsx scripts/delete-account.ts <owner-email | salon-slug>          # dry run
//   npx tsx scripts/delete-account.ts <owner-email | salon-slug> --yes    # delete
//
// The dry run prints exactly what would go and changes nothing. Tables are
// FORCE-RLS, so DATABASE_URL must be a role that bypasses RLS (the Neon owner
// role does; the restricted salonbook_app role does not).
//
// Left alone on purpose:
//   * Client rows (the end customers' phone-OTP logins) — they are global, not
//     owned by the salon, and may book at other salons. Their reviews of this
//     salon do go.
//   * A user who also belongs to ANOTHER account, and platform admins: only
//     their membership here is removed, never the login itself.
//   * AuditLog rows of the account stay as history, plus one "account.delete"
//     entry recording who/what was removed.
import { prisma } from "../src/lib/prisma";

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
  if (!accountId) {
    console.error(`No account found for '${key}'.`);
    process.exitCode = 1;
    return;
  }

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      name: true,
      salons: { select: { id: true, name: true, slug: true } },
      subscription: { select: { id: true, plan: true, status: true } },
      memberships: { select: { userId: true, role: true, user: { select: { email: true } } } },
    },
  });
  const salonIds = account.salons.map((s) => s.id);
  const bySalon = { salonId: { in: salonIds } };

  // A login goes only if this account is all it belongs to and it isn't a
  // platform admin; otherwise just its membership here is dropped.
  const memberUserIds = [...new Set(account.memberships.map((m) => m.userId))];
  const keep = new Set(
    (
      await prisma.membership.findMany({
        where: { userId: { in: memberUserIds }, accountId: { not: accountId } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );
  for (const u of await prisma.user.findMany({
    where: { id: { in: memberUserIds }, isPlatformAdmin: true },
    select: { id: true },
  })) {
    keep.add(u.id);
  }
  const userIds = memberUserIds.filter((id) => !keep.has(id));
  const emailOf = new Map(account.memberships.map((m) => [m.userId, m.user.email]));

  const [appointments, customers, payments, employees, notifications] = await Promise.all([
    prisma.appointment.count({ where: bySalon }),
    prisma.customer.count({ where: bySalon }),
    prisma.appointmentPayment.count({ where: bySalon }),
    prisma.employee.count({ where: bySalon }),
    prisma.notification.count({ where: bySalon }),
  ]);

  console.log(`Account:       ${account.name} (${accountId})`);
  console.log(
    `Subscription:  ${account.subscription ? `${account.subscription.plan} / ${account.subscription.status}` : "—"}`,
  );
  console.log(`Branches:      ${account.salons.map((s) => `${s.name} [/${s.slug}]`).join(", ") || "—"}`);
  console.log(`Appointments:  ${appointments}`);
  console.log(`Clients:       ${customers}`);
  console.log(`Visit payments:${String(payments).padStart(2)}`);
  console.log(`Employees:     ${employees}`);
  console.log(`Notifications: ${notifications}`);
  console.log(`Logins deleted (email freed): ${userIds.map((id) => emailOf.get(id)).join(", ") || "—"}`);
  if (keep.size > 0) {
    console.log(
      `Logins kept (other account / platform admin), membership removed only: ${[...keep].map((id) => emailOf.get(id)).join(", ")}`,
    );
  }

  if (!confirm) {
    console.log("\nDry run — nothing deleted. Re-run with --yes to delete all of the above.");
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      // Children before parents: most FKs here are RESTRICT, not CASCADE.
      await tx.appointmentAddon.deleteMany({ where: bySalon });
      await tx.appointmentPayment.deleteMany({ where: bySalon });
      await tx.review.deleteMany({ where: bySalon });
      await tx.notification.deleteMany({ where: bySalon });
      await tx.customerNote.deleteMany({ where: bySalon });
      await tx.appointment.deleteMany({ where: bySalon });
      await tx.customer.deleteMany({ where: bySalon });
      await tx.payout.deleteMany({ where: bySalon });
      await tx.usageCounter.deleteMany({ where: bySalon });
      await tx.pushSubscription.deleteMany({
        where: { OR: [bySalon, { userId: { in: userIds } }] },
      });
      await tx.membership.deleteMany({ where: { accountId } });
      // WorkingHour/TimeOff/ServiceEmployee/ServiceAddonLink cascade from these.
      await tx.employee.deleteMany({ where: bySalon });
      await tx.service.deleteMany({ where: bySalon });
      await tx.serviceAddon.deleteMany({ where: bySalon });
      // WhatsAppSender cascades from the salon.
      await tx.salon.deleteMany({ where: { accountId } });
      if (account.subscription) {
        await tx.payment.deleteMany({ where: { subscriptionId: account.subscription.id } });
        await tx.subscription.delete({ where: { id: account.subscription.id } });
      }
      // LegalConsent cascades from the account.
      await tx.account.delete({ where: { id: accountId } });
      // Guide state/events and reset tokens cascade from the user.
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.auditLog.create({
        data: {
          accountId,
          action: "account.delete",
          target: accountId,
          meta: {
            name: account.name,
            slugs: account.salons.map((s) => s.slug),
            emails: userIds.map((id) => emailOf.get(id) ?? null),
            via: "scripts/delete-account.ts",
          },
        },
      });
    },
    { timeout: 60_000 },
  );

  console.log("\nDeleted. The email(s) and link(s) above can be registered again.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
