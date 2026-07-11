import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

// Shared shell for the static legal pages (/privacy, /terms). Plain typography
// without the tailwind typography plugin: Section/P keep the markup terse.

export async function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  /** Human-readable "last updated" date, e.g. "6 iyul 2026". */
  updated: string;
  children: ReactNode;
}) {
  const t = await getTranslations("Legal");
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("lastUpdated")}: {updated}</p>
        <div className="mt-10 space-y-10">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-muted-foreground">{children}</p>;
}

export function Li({ children }: { children: ReactNode }) {
  return (
    <li className="text-[15px] leading-relaxed text-muted-foreground marker:text-muted-foreground">
      {children}
    </li>
  );
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}
