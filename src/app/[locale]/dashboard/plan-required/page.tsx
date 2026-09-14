import { requirePagePermission } from "@/lib/auth/guards";
import { PlanRequired } from "../_components/plan-required";

export const dynamic = "force-dynamic";

// Where requirePagePermission() sends a non-owner whose salon's plan lacks the
// page they opened. Any working login may land here, so it asks only for what
// every role holds.
export default async function PlanRequiredPage() {
  await requirePagePermission("bookings.read");
  return <PlanRequired />;
}
