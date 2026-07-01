import { ArrowLeft } from "lucide-react";
import { ButtonLink, Eyebrow } from "@/components/ui";
import { Logo } from "@/components/site-header";
import { ThemeToggle } from "@/components/theme-toggle";

export default function NotFound() {
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
          Səhifə tapılmadı
        </h1>
        <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
          Axtardığınız salon mövcud deyil və ya artıq aktiv deyil. Linki yoxlayıb
          yenidən cəhd edin.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/" variant="primary" size="lg">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            Ana səhifə
          </ButtonLink>
          <ButtonLink href="/demostudio" variant="secondary" size="lg">
            Nümunə səhifəyə bax
          </ButtonLink>
        </div>
      </main>
    </div>
  );
}
