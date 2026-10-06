import { prisma } from "@/lib/prisma";

// Deletes a salon account completely — every branch, its bookings, clients,
// payments, staff logins, the subscription, and the owner's login — so the
// email (and the salon's link) can be registered again from scratch. Used by
// the platform-admin panel and by scripts/delete-account.ts. Irreversible.
//
// Left alone on purpose:
//   * Client rows (the end customers' phone-OTP logins) — they are global, not
//     owned by the salon, and may book at other salons. Their reviews of this
//     salon do go.
//   * A user who also belongs to ANOTHER account, and platform admins: only
//     their membership here is removed, never the login itself.
//   * AuditLog rows of the account stay as history, plus one "account.delete"
//     entry recording who/what was removed.
//
// Tables are FORCE-RLS, so this must run on a connection that bypasses RLS —
// the base `prisma` client, never the restricted tenant one.

export type AccountDeletionPlan = {
  accountId: string;
  name: string;
  salons: { id: string; name: string; slug: string }[];
  subscription: { id: string; plan: string; status: string } | null;
  /** Logins removed with the account; their emails become free again. */
  deletedEmails: string[];
  /** Logins kept (another account / platform admin); only the membership goes. */
  keptEmails: string[];
  counts: {
    appointments: number;
    customers: number;
    visitPayments: number;
    employees: number;
    notifications: number;
  };
  /** Internal: the user rows deleted with the account. */
  userIds: string[];
};

/** What deleting the account would remove. Changes nothing; null if not found. */
export async function planAccountDeletion(accountId: string): Promise<AccountDeletionPlan | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      name: true,
      salons: { select: { id: true, name: true, slug: true }, orderBy: { createdAt: "asc" } },
      subscription: { select: { id: true, plan: true, status: true } },
      memberships: { select: { userId: true, user: { select: { email: true } } } },
    },
  });
  if (!account) return null;

  const salonIds = account.salons.map((s) => s.id);
  const bySalon = { salonId: { in: salonIds } };

  // A login goes only if this account is all it belongs to and it isn't a
  // platform admin; otherwise just its membership here is dropped.
  const memberUserIds = [...new Set(account.memberships.map((m) => m.userId))];
  const [elsewhere, admins] = await Promise.all([
    prisma.membership.findMany({
      where: { userId: { in: memberUserIds }, accountId: { not: accountId } },
      select: { userId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: memberUserIds }, isPlatformAdmin: true },
      select: { id: true },
    }),
  ]);
  const keep = new Set([...elsewhere.map((m) => m.userId), ...admins.map((u) => u.id)]);
  const userIds = memberUserIds.filter((id) => !keep.has(id));
  const emailOf = new Map(account.memberships.map((m) => [m.userId, m.user.email]));

  const [appointments, customers, visitPayments, employees, notifications] = await Promise.all([
    prisma.appointment.count({ where: bySalon }),
    prisma.customer.count({ where: bySalon }),
    prisma.appointmentPayment.count({ where: bySalon }),
    prisma.employee.count({ where: bySalon }),
    prisma.notification.count({ where: bySalon }),
  ]);

  return {
    accountId,
    name: account.name,
    salons: account.salons,
    subscription: account.subscription,
    deletedEmails: userIds.map((id) => emailOf.get(id)!),
    keptEmails: [...keep].map((id) => emailOf.get(id)!),
    counts: { appointments, customers, visitPayments, employees, notifications },
    userIds,
  };
}

/** Deletes everything in the plan in one transaction, and audits it. */
export async function deleteAccountCompletely(
  plan: AccountDeletionPlan,
  audit: { actorUserId: string | null; via: string },
): Promise<void> {
  const { accountId, userIds } = plan;
  const bySalon = { salonId: { in: plan.salons.map((s) => s.id) } };

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
      // The subscription is read inside the transaction, not taken from the
      // plan: one created since the plan was made would otherwise block the
      // account delete below.
      const sub = await tx.subscription.findUnique({ where: { accountId }, select: { id: true } });
      if (sub) {
        await tx.payment.deleteMany({ where: { subscriptionId: sub.id } });
        await tx.subscription.delete({ where: { id: sub.id } });
      }
      // LegalConsent cascades from the account.
      await tx.account.delete({ where: { id: accountId } });
      // Guide state/events and reset tokens cascade from the user.
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      await tx.auditLog.create({
        data: {
          accountId,
          actorUserId: audit.actorUserId,
          action: "account.delete",
          target: accountId,
          meta: {
            name: plan.name,
            slugs: plan.salons.map((s) => s.slug),
            emails: plan.deletedEmails,
            counts: plan.counts,
            via: audit.via,
          },
        },
      });
    },
    { timeout: 60_000 },
  );
}
