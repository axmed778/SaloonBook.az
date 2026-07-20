"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarNav } from "./sidebar-nav";
import { BranchSwitcher, type BranchOption } from "./branch-switcher";
import { LogoutButton } from "../logout-button";

type User = { name: string; role: string; initial: string };
type BranchData = { branches: BranchOption[]; activeId: string };

const STORAGE_KEY = "sb_sidebar_collapsed";

// The dashboard frame: a collapsible sidebar on desktop (icon-rail toggle,
// remembered in localStorage) and an off-canvas drawer on mobile (hamburger).
export function DashboardShell({
  user,
  isAdmin = false,
  branch = null,
  children,
}: {
  user: User;
  isAdmin?: boolean;
  branch?: BranchData | null;
  children: React.ReactNode;
}) {
  const t = useTranslations("Nav");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restore the desktop collapsed preference after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        className={
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 lg:flex " +
          (collapsed ? "w-[76px]" : "w-64")
        }
      >
        <SidebarContent
          user={user}
          isAdmin={isAdmin}
          branch={branch}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      </aside>

      {/* Mobile drawer + backdrop */}
      <div className={"lg:hidden " + (mobileOpen ? "" : "pointer-events-none")}>
        <div
          className={
            "fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 " +
            (mobileOpen ? "opacity-100" : "opacity-0")
          }
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={
            "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-background transition-transform duration-200 " +
            (mobileOpen ? "translate-x-0" : "-translate-x-full")
          }
        >
          <SidebarContent
            user={user}
            isAdmin={isAdmin}
            branch={branch}
            collapsed={false}
            onNavigate={() => setMobileOpen(false)}
            onClose={() => setMobileOpen(false)}
          />
        </aside>
      </div>

      {/* Right side: mobile top bar + page content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label={t("menu")} title={t("menu")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-secondary-foreground transition hover:bg-hover"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          </button>
          {/* With multi-branch active, the top bar shows WHICH branch you're on
              (tappable switcher) instead of the static brand — the brand still
              lives in the drawer. */}
          {branch ? (
            <BranchSwitcher branches={branch.branches} activeId={branch.activeId} compact />
          ) : (
            <span className="font-semibold tracking-tight">
              SalonBook<span className="text-rose-700 dark:text-rose-400">.az</span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({
  user,
  isAdmin,
  branch,
  collapsed,
  onToggleCollapse,
  onNavigate,
  onClose,
}: {
  user: User;
  isAdmin: boolean;
  branch?: BranchData | null;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const t = useTranslations("Nav");
  return (
    <div className="flex h-full flex-col">
      {/* Header: logo + collapse (desktop) / close (mobile) */}
      <div
        className={
          "flex px-3 py-4 " +
          (collapsed ? "flex-col items-center gap-3" : "items-center justify-between")
        }
      >
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-sm font-bold text-white">
            S
          </span>
          {!collapsed && (
            <span className="font-semibold tracking-tight">
              SalonBook<span className="text-rose-700 dark:text-rose-400">.az</span>
            </span>
          )}
        </div>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label={t("toggleMenu")} title={t("toggleMenu")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
            </svg>
          </button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            aria-label={t("close")} title={t("close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* Active-branch switcher (Pro, multi-branch): sits right above the nav —
          the first thing seen next to Təqvim. Outside the scrollable nav box so
          its dropdown never gets clipped. */}
      {branch && (
        <div className={"px-3 pb-2 " + (collapsed ? "flex justify-center" : "")}>
          <BranchSwitcher
            branches={branch.branches}
            activeId={branch.activeId}
            collapsed={collapsed}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <SidebarNav collapsed={collapsed} onNavigate={onNavigate} isAdmin={isAdmin} />
      </div>

      <div className="border-t border-border p-3">
        <div
          className={
            "flex items-center rounded-lg " +
            (collapsed ? "justify-center px-0 py-2" : "gap-3 px-2 py-2")
          }
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
            {user.initial}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
              <p className="truncate text-xs text-faint-foreground">{user.role}</p>
            </div>
          )}
        </div>
        <div className={"mt-2 flex items-center gap-2 " + (collapsed ? "justify-center" : "")}>
          {!collapsed && <LanguageSwitcher direction="up" />}
          <ThemeToggle />
        </div>
        <div className="mt-2">
          <LogoutButton collapsed={collapsed} />
        </div>
      </div>
    </div>
  );
}
