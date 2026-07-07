import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
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
  if (!session) redirect("/login");

  const displayName = session.user.fullName?.trim() || session.user.email;
  const roleLabel = session.isAdmin ? "Platform Admin" : "Salon sahibi";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <DashboardShell
      user={{ name: displayName, role: roleLabel, initial }}
      isAdmin={session.isAdmin}
    >
      {children}
    </DashboardShell>
  );
}
