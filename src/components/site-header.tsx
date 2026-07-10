import { CalendarCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 ${className ?? ""}`}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-accent shadow-soft transition-colors group-hover:border-border-strong">
        <CalendarCheck className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        SalonBook<span className="text-muted-foreground">.az</span>
      </span>
    </Link>
  );
}

export async function SiteHeader() {
  const t = await getTranslations("Header");

  // Rooted (/#…) so the nav also works from non-landing pages (/privacy, /terms).
  const nav = [
    { label: t("navFeatures"), href: "/#features" },
    { label: t("navHow"), href: "/#how" },
    { label: t("navPricing"), href: "/#pricing" },
    { label: t("navFaq"), href: "/#faq" },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo className="shrink-0" />

        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
            {t("login")}
          </ButtonLink>
          <ButtonLink href="/register" variant="primary" size="sm">
            {t("start")}
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
