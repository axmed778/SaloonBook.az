import { cookies } from "next/headers";
import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/auth/session";
import { A2HS_DISMISS_COOKIE } from "@/components/pwa/constants";
import { ConsentGate } from "@/components/legal/consent-gate";
import { gateDocs, staleSalonDocs } from "@/lib/legal-consent";
import { acceptLegalConsents } from "./actions";
import { LogoutButton } from "./logout-button";
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

  // A master whose login has been cut off — the account fell to a tier without
  // staff logins, or the owner deactivated them — keeps a valid session but no
  // salon. Say which it is: they cannot fix either themselves, and an empty
  // dashboard would just look broken.
  if (session.staffBlocked) {
    const tb = await getTranslations("StaffBlocked");
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16 text-center">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{tb("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{tb(session.staffBlocked)}</p>
        </div>
        <LogoutButton />
      </main>
    );
  }

  const t = await getTranslations("Nav");
  const displayName = session.user.fullName?.trim() || session.user.email;
  const roleLabel = session.isAdmin
    ? t("roleAdmin")
    : session.isStaff
      ? t("roleStaff")
      : t("roleOwner");
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

  // Re-consent gate: blocks the dashboard when a legal document the account
  // accepted has since been revised. Platform admins are exempt — they have no
  // membership, so there is no account to record an acceptance against. So are
  // masters: accepting a revised offer binds the paying account, which is the
  // owner's decision, and blocking a master's day on it would strand them.
  const stale =
    session.role === "OWNER" && session.accountId ? staleSalonDocs(session.legal) : [];

  return (
    <DashboardShell
      user={{ name: displayName, role: roleLabel, initial }}
      isAdmin={session.isAdmin}
      isStaff={session.isStaff}
      branch={branch}
      installDismissed={installDismissed}
    >
      {children}
      {stale.length > 0 && (
        <ConsentGate
          docs={gateDocs(stale)}
          logoutPath="/api/auth/logout"
          logoutHref="/login"
          accept={acceptLegalConsents}
        />
      )}
    </DashboardShell>
  );
}
