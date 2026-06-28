import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LogoutButton } from "./logout-button";

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

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <a href="/dashboard" className="font-semibold">
            SalonBook.az
          </a>
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-500">{displayName}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
