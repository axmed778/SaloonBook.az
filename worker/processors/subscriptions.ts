import { prisma } from "../../src/lib/prisma";
import { GRACE_DAYS } from "../../src/lib/subscription";

/**
 * Nightly subscription sweep. Enforcement itself never depends on this —
 * effectivePlan() is time-aware and downgrades entitlements the moment a trial
 * or paid period lapses. The sweep makes the DB status truthful so the
 * dashboard (trial nudge, billing page) and the owner's manual billing list
 * show the real state:
 *  - TRIALING past trialEndsAt            → FREE_DOWNGRADED
 *  - ACTIVE past currentPeriodEnd + grace → PAST_DUE
 */
export async function sweepSubscriptions(): Promise<void> {
  const now = new Date();

  const expiredTrials = await prisma.subscription.updateMany({
    where: { status: "TRIALING", trialEndsAt: { lt: now } },
    data: { status: "FREE_DOWNGRADED" },
  });

  const graceCutoff = new Date(now.getTime() - GRACE_DAYS * 86_400_000);
  const lapsed = await prisma.subscription.updateMany({
    where: { status: "ACTIVE", currentPeriodEnd: { lt: graceCutoff } },
    data: { status: "PAST_DUE" },
  });

  if (expiredTrials.count > 0 || lapsed.count > 0) {
    console.log(
      `[worker] subscription sweep: ${expiredTrials.count} trial(s) → FREE_DOWNGRADED, ` +
        `${lapsed.count} active → PAST_DUE`,
    );
  }
}
