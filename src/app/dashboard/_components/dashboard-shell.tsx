"use client";

import { useEffect, useState } from "react";
import { SidebarNav } from "./sidebar-nav";
import { LogoutButton } from "../logout-button";

type User = { name: string; role: string; initial: string };

const STORAGE_KEY = "sb_sidebar_collapsed";

// The dashboard frame: a collapsible sidebar on desktop (icon-rail toggle,
// remembered in localStorage) and an off-canvas drawer on mobile (hamburger).
export function DashboardShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
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
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Desktop sidebar */}
      <aside
        className={
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 transition-[width] duration-200 lg:flex " +
          (collapsed ? "w-[76px]" : "w-64")
        }
      >
        <SidebarContent user={user} collapsed={collapsed} onToggleCollapse={toggleCollapse} />
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
            "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-800 bg-zinc-950 transition-transform duration-200 " +
            (mobileOpen ? "translate-x-0" : "-translate-x-full")
          }
        >
          <SidebarContent
            user={user}
            collapsed={false}
            onNavigate={() => setMobileOpen(false)}
            onClose={() => setMobileOpen(false)}
          />
        </aside>
      </div>

      {/* Right side: mobile top bar + page content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Menyu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 text-zinc-300 transition hover:bg-zinc-800/60"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          </button>
          <span className="font-semibold tracking-tight">
            SalonBook<span className="text-rose-400">.az</span>
          </span>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({
  user,
  collapsed,
  onToggleCollapse,
  onNavigate,
  onClose,
}: {
  user: User;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
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
              SalonBook<span className="text-rose-400">.az</span>
            </span>
          )}
        </div>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label="Menyunu yığ/aç"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
            </svg>
          </button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Bağla"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <SidebarNav collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      <div className="border-t border-zinc-800 p-3">
        <div
          className={
            "flex items-center rounded-lg " +
            (collapsed ? "justify-center px-0 py-2" : "gap-3 px-2 py-2")
          }
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-zinc-200">
            {user.initial}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">{user.name}</p>
              <p className="truncate text-xs text-zinc-500">{user.role}</p>
            </div>
          )}
        </div>
        <div className="mt-2">
          <LogoutButton collapsed={collapsed} />
        </div>
      </div>
    </div>
  );
}
