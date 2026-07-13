"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const t = useTranslations("ThemeToggle");
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Read from localStorage (the source of truth), not the <html> class, so the
    // toggle stays correct regardless of when ThemeSync re-applies the class on a
    // navigation.
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("theme");
    } catch {
      /* storage disabled — fall back to the class below */
    }
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    } else {
      setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
    }
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode / storage disabled — ignore */
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? t("toLight") : t("toDark")}
      title={theme === "dark" ? t("toLight") : t("toDark")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Render the icon only after mount to avoid a hydration mismatch. */}
      <span className="sr-only">{t("theme")}</span>
      {mounted &&
        (theme === "dark" ? (
          <Sun className="h-[18px] w-[18px]" strokeWidth={2} />
        ) : (
          <Moon className="h-[18px] w-[18px]" strokeWidth={2} />
        ))}
    </button>
  );
}
