"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";

export type PublicBranch = { slug: string; name: string; address: string | null };

// Branch dropdown on the public booking page (Pro multi-branch salons). The
// account shares ONE booking link; the client picks which branch to visit here.
// Selection navigates to ?branch=<slug> — the page re-renders server-side with
// that branch's services/employees, and the widget's API calls target it.
export function BranchPicker({
  branches,
  activeSlug,
}: {
  branches: PublicBranch[];
  activeSlug: string;
}) {
  const t = useTranslations("SalonPage");
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const active = branches.find((b) => b.slug === activeSlug) ?? branches[0];

  function pick(slug: string) {
    setOpen(false);
    if (slug === activeSlug) return;
    startTransition(() => {
      router.replace(`${pathname}?branch=${encodeURIComponent(slug)}`, { scroll: false });
    });
  }

  return (
    <section className="mt-8">
      <div className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
        <h3 className="text-base font-semibold text-foreground">{t("branchTitle")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("branchQuestion")}</p>

        <div className="relative mt-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={isPending}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={t("branchTitle")}
            className="flex w-full items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-left transition hover:border-accent disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" strokeWidth={2} />
            ) : (
              <MapPin className="h-5 w-5 shrink-0 text-accent" strokeWidth={2} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{active?.name}</span>
              {active?.address && (
                <span className="block truncate text-sm text-muted-foreground">
                  {active.address}
                </span>
              )}
            </span>
            <ChevronDown
              className={
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform " +
                (open ? "rotate-180" : "")
              }
              strokeWidth={2}
            />
          </button>

          {open && (
            <>
              {/* Backdrop closes the menu on outside click. */}
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div
                role="listbox"
                aria-label={t("branchTitle")}
                className="absolute inset-x-0 top-full z-50 mt-2 max-h-[50vh] overflow-auto rounded-xl border border-border bg-card py-1 shadow-lg"
              >
                {branches.map((b) => {
                  const isActive = b.slug === activeSlug;
                  return (
                    <button
                      key={b.slug}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => pick(b.slug)}
                      className={
                        "flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover " +
                        (isActive ? "text-foreground" : "text-muted-foreground")
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{b.name}</span>
                        {b.address && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-faint-foreground">
                            <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
                            <span className="truncate">{b.address}</span>
                          </span>
                        )}
                      </span>
                      {isActive && (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
