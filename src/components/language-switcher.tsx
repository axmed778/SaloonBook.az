"use client";

import { useState, useTransition } from "react";
import { Globe, Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

// Each locale labelled in its own language, plus a short code for the button.
const LOCALES: { value: Locale; label: string; code: string }[] = [
  { value: "az", label: "Azərbaycanca", code: "AZ" },
  { value: "en", label: "English", code: "EN" },
  { value: "ru", label: "Русский", code: "RU" },
];

// Compact language picker. Switching keeps the current path and swaps the locale
// prefix via a soft navigation (no full reload); next-intl persists the choice
// in the NEXT_LOCALE cookie.
//
// `direction` controls which way the menu opens: "down" (default) for top-of-page
// placements (headers), "up" for the dashboard sidebar footer — where a downward
// menu would spill past the bottom of the viewport and get clipped.
export function LanguageSwitcher({
  direction = "down",
}: {
  direction?: "up" | "down";
} = {}) {
  const t = useTranslations("LanguageSwitcher");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const current = LOCALES.find((l) => l.value === locale) ?? LOCALES[0];

  function switchTo(next: Locale) {
    setOpen(false);
    if (next === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        aria-label={t("label")}
        title={t("label")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 sm:px-2.5"
      >
        <Globe className="h-[18px] w-[18px]" strokeWidth={2} />
        {/* Code is redundant on phones where header space is tight; the globe
            alone is enough. Show the code from sm up. */}
        <span className="hidden font-medium sm:inline">{current.code}</span>
      </button>

      {open && (
        <>
          {/* Backdrop closes the menu on outside click. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className={
              "absolute z-50 max-h-[60vh] w-44 overflow-auto rounded-xl border border-border bg-card py-1 shadow-lg " +
              (direction === "up" ? "bottom-full left-0 mb-2" : "top-full right-0 mt-2")
            }
          >
            {routing.locales.map((value) => {
              const item = LOCALES.find((l) => l.value === value)!;
              const active = value === locale;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => switchTo(value)}
                  className={
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-hover " +
                    (active ? "text-foreground" : "text-muted-foreground")
                  }
                >
                  <span>{item.label}</span>
                  {active && <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
