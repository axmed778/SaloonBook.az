"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";

export type SortKey = "name" | "last" | "visits" | "spent";

export type ClientRow = {
  id: string;
  name: string;
  phone: string;
  visits: number;
  spentMinor: number;
  lastVisitLabel: string | null;
  favEmployee: string | null;
  active: boolean;
};

function buildQuery(next: { q?: string; sort?: SortKey; dir?: string; page?: number }): string {
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.sort && next.sort !== "last") p.set("sort", next.sort);
  if (next.dir && next.dir !== "desc") p.set("dir", next.dir);
  if (next.page && next.page > 1) p.set("page", String(next.page));
  const s = p.toString();
  return s ? `/dashboard/clients?${s}` : "/dashboard/clients";
}

function StatusChip({ active }: { active: boolean }) {
  const t = useTranslations("Clients");
  return active ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      {t("statusActive")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-faint-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
      {t("statusInactive")}
    </span>
  );
}

export function ClientsTable({
  rows,
  total,
  page,
  pageSize,
  q,
  sort,
  dir,
  salonIsEmpty,
}: {
  rows: ClientRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  sort: SortKey;
  dir: "asc" | "desc";
  salonIsEmpty: boolean;
}) {
  const t = useTranslations("Clients");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Instant search: local input state stays snappy; the URL (and the server
  // query behind it) follows after a short debounce.
  useEffect(() => {
    if (query === q) return;
    debounceRef.current && clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        router.replace(buildQuery({ q: query.trim(), sort, dir }), { scroll: false });
      });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function toggleSort(key: SortKey) {
    const nextDir = sort === key && dir === "desc" ? "asc" : "desc";
    startTransition(() => {
      router.replace(buildQuery({ q, sort: key, dir: nextDir }), { scroll: false });
    });
  }

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-faint-foreground">
          {total > 0 ? t("subtitleWithCount", { count: total }) : t("subtitleEmpty")}
        </p>
      </div>
      <div className="relative w-full sm:w-72">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label={t("clearSearch")} title={t("clearSearch")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-faint-foreground transition hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>
    </div>
  );

  // Salon has no customers at all — friendly first-run state.
  if (salonIsEmpty) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {header}
        <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-xl border border-border bg-card px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-400">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-medium text-secondary-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 max-w-sm text-sm text-faint-foreground">
            {t("emptyBody")}
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            {t("goToCalendar")}
          </Link>
        </div>
      </div>
    );
  }

  const sortableHeaders: { key: SortKey; label: string; align?: "right" }[] = [
    { key: "name", label: t("colCustomer") },
    { key: "visits", label: t("colVisits"), align: "right" },
    { key: "last", label: t("colLastVisit") },
    { key: "spent", label: t("colSpent"), align: "right" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      {header}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-secondary-foreground">
            {t("noResults", { q })}
          </p>
          <p className="mt-1 text-sm text-faint-foreground">{t("noResultsHint")}</p>
        </div>
      ) : (
        <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-faint-foreground">
                  {sortableHeaders.map((h) => (
                    <th
                      key={h.key}
                      className={"px-4 py-3 font-medium" + (h.align === "right" ? " text-right" : "")}
                    >
                      <button
                        onClick={() => toggleSort(h.key)}
                        className="inline-flex items-center gap-1 transition hover:text-foreground"
                      >
                        {h.label}
                        {sort === h.key && (
                          <span className="text-rose-700 dark:text-rose-400">{dir === "desc" ? "↓" : "↑"}</span>
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">{t("colFavEmployee")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/dashboard/clients/${r.id}`)}
                    className="cursor-pointer border-b border-border transition last:border-0 hover:bg-hover"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/clients/${r.id}`}
                        className="font-medium text-foreground hover:text-rose-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.name}
                      </Link>
                      <div className="mt-0.5 text-xs text-faint-foreground">{r.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-secondary-foreground">{r.visits}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.lastVisitLabel ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      {azn(r.spentMinor)} ₼
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.favEmployee ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusChip active={r.active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/dashboard/clients/${r.id}`}
                  className="block rounded-xl border border-border bg-card p-4 transition hover:border-border-strong"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">{r.name}</p>
                    <StatusChip active={r.active} />
                  </div>
                  <p className="mt-0.5 text-xs text-faint-foreground">{r.phone}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {t("visitsShort", { count: r.visits })}
                      {r.lastVisitLabel ? t("lastVisitInline", { date: r.lastVisitLabel }) : ""}
                    </span>
                    <span className="font-medium text-secondary-foreground">{azn(r.spentMinor)} ₼</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-faint-foreground">
          <span>
            {from}–{to} / {total}
          </span>
          <div className="flex gap-2">
            <Link
              href={buildQuery({ q, sort, dir, page: page - 1 })}
              aria-disabled={page <= 1}
              className={
                "rounded-lg border border-border px-3 py-1.5 transition " +
                (page <= 1
                  ? "pointer-events-none text-faint-foreground"
                  : "text-secondary-foreground hover:border-border-strong hover:text-foreground")
              }
            >
              ← {t("prev")}
            </Link>
            <Link
              href={buildQuery({ q, sort, dir, page: page + 1 })}
              aria-disabled={page >= lastPage}
              className={
                "rounded-lg border border-border px-3 py-1.5 transition " +
                (page >= lastPage
                  ? "pointer-events-none text-faint-foreground"
                  : "text-secondary-foreground hover:border-border-strong hover:text-foreground")
              }
            >
              {t("next")} →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
