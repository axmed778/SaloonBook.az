"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
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
      aria-label={theme === "dark" ? "İşıqlı rejimə keç" : "Qaranlıq rejimə keç"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Render the icon only after mount to avoid a hydration mismatch. */}
      <span className="sr-only">Mövzu</span>
      {mounted &&
        (theme === "dark" ? (
          <Sun className="h-[18px] w-[18px]" strokeWidth={2} />
        ) : (
          <Moon className="h-[18px] w-[18px]" strokeWidth={2} />
        ))}
    </button>
  );
}
