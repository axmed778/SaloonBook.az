import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requirePageAccess } from "@/lib/auth/guards";
import { AccessClosed } from "../_components/access-closed";

export const dynamic = "force-dynamic";

// Where requirePagePermission() sends a closed login. It renders the refusal
// itself instead of redirecting, which is what keeps a closed login from bouncing
// between pages. A login that is not closed (any more) has nothing to read here
// and goes to its day.
export default async function AccessClosedPage() {
  const access = await requirePageAccess("bookings.read");
  if (!access.granted && access.reason === "blocked") {
    return <AccessClosed reason={access.blocked} />;
  }
  redirect({ href: "/dashboard", locale: await getLocale() });
  return null;
}
