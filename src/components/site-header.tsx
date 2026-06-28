import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { label: "İmkanlar", href: "#features" },
  { label: "Necə işləyir", href: "#how" },
  { label: "Qiymətlər", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

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

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <ButtonLink href="/dashboard" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Daxil ol
          </ButtonLink>
          <ButtonLink href="/dashboard" variant="primary" size="sm">
            Başla
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
