import { getTranslations } from "next-intl/server";
import type { StaffBlockedReason } from "@/lib/auth/session";
import { LogoutButton } from "../logout-button";

/**
 * The screen a closed login sees: why, and a way out. Its holder cannot fix any
 * of the reasons themselves, and an empty dashboard would just look broken.
 * Shown by the dashboard layout and by /dashboard/access-closed.
 */
export async function AccessClosed({ reason }: { reason: StaffBlockedReason }) {
  const t = await getTranslations("StaffBlocked");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16 text-center">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t(reason)}</p>
      </div>
      <LogoutButton />
    </main>
  );
}
