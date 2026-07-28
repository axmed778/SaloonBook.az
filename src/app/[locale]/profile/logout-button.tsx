"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export function LogoutButton() {
  const t = useTranslations("ClientAuth");
  const router = useRouter();
  const [pending, start] = useTransition();

  function logout() {
    start(async () => {
      await fetch("/api/client/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    });
  }

  return (
    <button
      onClick={logout}
      disabled={pending}
      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover disabled:opacity-60"
    >
      {pending ? t("loggingOut") : t("logout")}
    </button>
  );
}
