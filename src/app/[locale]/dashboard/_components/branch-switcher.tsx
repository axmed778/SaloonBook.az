"use client";

import { useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2, MapPin, Store } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { switchBranch } from "../actions";

export type BranchOption = { id: string; name: string; address: string | null };

// Active-branch picker for multi-branch (Pro) accounts. Rendered at the top of
// the dashboard sidebar (above Təqvim) and in the mobile top bar, so the owner
// always sees WHICH branch the calendar/clients/etc. are showing. Picking a
// branch calls the switchBranch action (sets the sb_branch cookie) and refreshes
// the router — every dashboard page re-renders scoped to the new branch.
export function BranchSwitcher({
  branches,
  activeId,
  collapsed = false,
  compact = false,
}: {
  branches: BranchOption[];
  activeId: string;
  /** Icon-only trigger for the collapsed sidebar rail. */
  collapsed?: boolean;
  /** Tight variant for the mobile top bar. */
  compact?: boolean;
}) {
  const t = useTranslations("Nav");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const active = branches.find((b) => b.id === activeId) ?? branches[0];

  function pick(id: string) {
    setOpen(false);
    if (id === activeId) return;
    startTransition(async () => {
      const res = await switchBranch({ salonId: id });
      if (res.ok) router.refresh();
    });
  }

  const triggerCls = compact
    ? "flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-sm font-medium text-foreground transition hover:border-rose-500/50"
    : collapsed
      ? "flex h-10 w-10 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-700 transition hover:border-rose-500/50 dark:text-rose-400"
      : "flex w-full items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-left transition hover:border-rose-500/50";

  return (
    <div className={"relative " + (compact ? "min-w-0" : "")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("branchSwitcherLabel")}
        title={collapsed ? active?.name : t("branchSwitcherLabel")}
        className={triggerCls + " disabled:opacity-60"}
      >
        {isPending ? (
          <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-rose-700 dark:text-rose-400" strokeWidth={2} />
        ) : (
          <Store className="h-[18px] w-[18px] shrink-0 text-rose-700 dark:text-rose-400" strokeWidth={2} />
        )}
        {!collapsed && (
          <>
            {compact ? (
              <span className="min-w-0 truncate">{active?.name}</span>
            ) : (
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-rose-700/80 dark:text-rose-400/80">
                  {t("branch")}
                </span>
                <span className="block truncate text-sm font-medium text-foreground">
                  {active?.name}
                </span>
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          </>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop closes the menu on outside click. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label={t("branchSwitcherLabel")}
            className="absolute left-0 top-full z-50 mt-2 max-h-[60vh] w-64 overflow-auto rounded-xl border border-border bg-card py-1 shadow-lg"
          >
            {branches.map((b) => {
              const isActive = b.id === activeId;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => pick(b.id)}
                  className={
                    "flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-hover " +
                    (isActive ? "text-foreground" : "text-muted-foreground")
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{b.name}</span>
                    {b.address && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-faint-foreground">
                        <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
                        <span className="truncate">{b.address}</span>
                      </span>
                    )}
                  </span>
                  {isActive && <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} />}
                </button>
              );
            })}
            <div className="mt-1 border-t border-border pt-1">
              <Link
                href="/dashboard/settings"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                {t("manageBranches")}
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
