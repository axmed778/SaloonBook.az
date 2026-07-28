import { cookies } from "next/headers";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/auth/session";
import { A2HS_DISMISS_COOKIE } from "@/components/pwa/constants";
import { DashboardShell } from "./_components/dashboard-shell";

export const dynamic = "force-dynamic";

// Route protection lives here (Node runtime) rather than Edge middleware, so the
// session crypto stays on node:crypto. Any unauthenticated request to /dashboard/*
// is bounced to /login before rendering. The visual frame (collapsible sidebar,
// mobile drawer) is the client DashboardShell.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/login", locale: await getLocale() });
    return null; // unreachable — redirect() throws — but narrows `session`
  }

  const t = await getTranslations("Nav");
  const displayName = session.user.fullName?.trim() || session.user.email;
  const roleLabel = session.isAdmin ? t("roleAdmin") : t("roleOwner");
  const initial = displayName.charAt(0).toUpperCase();

  // Branch switcher: only meaningful for a Pro owner with 2+ ACTIVE branches.
  // Everyone else (staff, single-branch, admins) never sees it.
  const branch =
    !session.isAdmin &&
    session.role === "OWNER" &&
    session.multiBranch &&
    session.branches.length > 1 &&
    session.salonId
      ? { branches: session.branches, activeId: session.salonId }
      : null;

  // Whether the owner already dismissed (or completed) the "Add to Home Screen"
  // prompt — read server-side so it never flashes for someone who dismissed it.
  const installDismissed = (await cookies()).get(A2HS_DISMISS_COOKIE)?.value === "1";

  return (
    <DashboardShell
      user={{ name: displayName, role: roleLabel, initial }}
      isAdmin={session.isAdmin}
      branch={branch}
      installDismissed={installDismissed}
    >
      {children}
    </DashboardShell>
  );
}
