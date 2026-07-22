import { prisma } from "../../src/lib/prisma";

// Fallback for the "close day" reconciliation (see the dashboard ReconcileBar).
// A CONFIRMED appointment whose end time is more than this long ago was never
// closed by the salon (completed / no-show). Auto-mark it COMPLETED with
// autoCompleted=true so realized revenue and payroll aren't stuck at zero, while
// the "unconfirmed" flag keeps it correctable to NO_SHOW by hand.
//
// 48h (not e.g. 12h) deliberately gives salons a couple of days to reconcile
// on their own before we assume "showed up" — the common case — and only then
// stops the ROI dashboard from reading empty.
const AUTO_COMPLETE_AFTER_MS = 48 * 60 * 60_000;

export async function reconcileOverdue(): Promise<void> {
  const cutoff = new Date(Date.now() - AUTO_COMPLETE_AFTER_MS);
  const res = await prisma.appointment.updateMany({
    where: { status: "CONFIRMED", endsAt: { lt: cutoff } },
    data: { status: "COMPLETED", autoCompleted: true },
  });
  if (res.count > 0) {
    console.log(`[reconcile] auto-completed ${res.count} unreconciled past appointment(s)`);
  }
}
