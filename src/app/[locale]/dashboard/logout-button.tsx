"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
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
      title={collapsed ? "Çıxış" : undefined}
      className={
        "flex w-full items-center rounded-lg border border-zinc-800 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800/60 hover:text-zinc-100 disabled:opacity-60 " +
        (collapsed ? "justify-center px-0 py-2" : "justify-center gap-2 px-3 py-2")
      }
    >
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
      </svg>
      {!collapsed && (busy ? "Çıxılır…" : "Çıxış")}
    </button>
  );
}
