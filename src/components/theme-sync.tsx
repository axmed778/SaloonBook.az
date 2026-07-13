"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// The blocking script in the root layout applies the saved theme on first paint,
// but it does not re-run on soft navigations. Switching locale re-renders <html>
// back to its default `dark` class (and the inline <script> never re-executes),
// which would drop the user's light/dark choice. Re-apply the saved theme on
// every path change so the choice survives a language switch.
export function ThemeSync() {
  // next/navigation's pathname includes the locale prefix, so it changes on a
  // language switch and re-triggers the effect (next-intl's usePathname strips
  // the locale and would not).
  const pathname = usePathname();

  useEffect(() => {
    try {
      let theme = localStorage.getItem("theme");
      if (theme !== "light" && theme !== "dark") {
        theme =
          window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
      }
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(theme);
    } catch {
      /* private mode / storage disabled — ignore */
    }
  }, [pathname]);

  return null;
}
