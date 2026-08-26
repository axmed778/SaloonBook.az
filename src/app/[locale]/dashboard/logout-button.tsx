"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { purgeCachedPrivatePages } from "@/lib/offline-cache";

export function LogoutButton({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations("Nav");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // Clearing the cookie does not touch Cache Storage; on a shared device the
      // previous session's dashboard pages would still be servable from disk.
      await purgeCachedPrivatePages();
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={collapsed ? t("logout") : undefined}
      className={
        "flex w-full items-center rounded-lg border border-border text-sm font-medium text-secondary-foreground transition hover:bg-hover hover:text-foreground disabled:opacity-60 " +
        (collapsed ? "justify-center px-0 py-2" : "justify-center gap-2 px-3 py-2")
      }
    >
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
      </svg>
      {!collapsed && (busy ? t("loggingOut") : t("logout"))}
    </button>
  );
}
