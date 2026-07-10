import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ButtonLink, Eyebrow } from "@/components/ui";
import { Logo } from "@/components/site-header";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] glow-accent opacity-60" />

      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <Eyebrow>404</Eyebrow>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
          {t("body")}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/" variant="primary" size="lg">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            {t("home")}
          </ButtonLink>
          <ButtonLink href="/demostudio" variant="secondary" size="lg">
            {t("viewDemo")}
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
