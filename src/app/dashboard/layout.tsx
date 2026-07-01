import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { LogoutButton } from "./logout-button";
import { SidebarNav } from "./_components/sidebar-nav";

export const dynamic = "force-dynamic";

// Route protection lives here (Node runtime) rather than Edge middleware, so the
// session crypto stays on node:crypto. Any unauthenticated request to /dashboard/*
// is bounced to /login before rendering.
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
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500 text-sm font-bold text-white">
            S
          </span>
          <Link href="/dashboard" className="font-semibold tracking-tight">
            SalonBook<span className="text-rose-400">.az</span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          <SidebarNav />
        </div>

        <div className="border-t border-zinc-800 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-zinc-200">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">{displayName}</p>
              <p className="truncate text-xs text-zinc-500">{roleLabel}</p>
            </div>
          </div>
          <div className="mt-2">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-6 py-6 lg:px-8">{children}</main>
    </div>
  );
}
