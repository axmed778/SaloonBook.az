import { getLocale, getTranslations } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { getClientSession } from "@/lib/auth/client-session";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

// Client account home. Gated on the client session; visit history lands here as
// a sub-route (added in a later commit).
export default async function ProfilePage() {
  const session = await getClientSession();
  const locale = await getLocale();
  if (!session) {
    redirect({ href: "/profile/sign-in", locale });
    return null; // unreachable — redirect() throws
  }
  const t = await getTranslations("ClientAuth");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("accountTitle")}</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{session.phone}</p>
      </div>

      <Link
        href="/profile/history"
        className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition hover:bg-hover"
      >
        {t("historyLink")}
        <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </Link>

      <LogoutButton />
    </main>
  );
}
