"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { CalendarColumn } from "./calendar-shared";

// Which masters the calendar shows. A salon with 30–40 masters cannot read a
// day of 40 columns or a week with every master merged, so reception narrows
// it to the people it is working with. The choice is stored as the HIDDEN ids
// (not the shown ones), so a master added later appears by default instead of
// silently missing from the calendar. Kept per browser: it is a view
// preference, not salon data.

const STORAGE_KEY = "salonbook.calendar.hiddenStaff";

export function useHiddenStaff(): [Set<string>, (next: Set<string>) => void] {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // Read after mount, not in the initializer: the server render has no
  // localStorage, and a different first client render would be a hydration
  // mismatch.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const ids: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(ids)) {
        setHidden(new Set(ids.filter((x): x is string => typeof x === "string")));
      }
    } catch {
      // Private mode / blocked storage: everyone stays visible.
    }
  }, []);

  const update = (next: Set<string>) => {
    setHidden(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // Not persisted; the filter still works for this page view.
    }
  };

  return [hidden, update];
}

export function StaffFilter({
  staff,
  hidden,
  onChange,
}: {
  staff: CalendarColumn[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const t = useTranslations("Calendar.staffFilter");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const shown = staff.filter((s) => !hidden.has(s.id)).length;
  const positions = [
    ...new Set(staff.map((s) => s.position?.trim()).filter((p): p is string => !!p)),
  ].sort((a, b) => a.localeCompare(b));
  const q = query.trim().toLocaleLowerCase();
  const list = q
    ? staff.filter(
        (s) =>
          s.name.toLocaleLowerCase().includes(q) ||
          (s.position ?? "").toLocaleLowerCase().includes(q),
      )
    : staff;

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  const showAll = () => onChange(new Set([...hidden].filter((id) => !staff.some((s) => s.id === id))));
  const hideAll = () => onChange(new Set([...hidden, ...staff.map((s) => s.id)]));
  // A position chip shows exactly that group and hides everyone else.
  const onlyPosition = (p: string) =>
    onChange(
      new Set([
        ...[...hidden].filter((id) => !staff.some((s) => s.id === id)),
        ...staff.filter((s) => s.position?.trim() !== p).map((s) => s.id),
      ]),
    );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:bg-hover " +
          (shown < staff.length
            ? "border-rose-500 text-foreground"
            : "border-border text-secondary-foreground")
        }
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        {t("label")}:{" "}
        {shown === staff.length ? t("all") : t("some", { shown, total: staff.length })}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-3 shadow-lg">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={showAll} className="rounded-md border border-border px-2 py-1 text-xs font-medium text-secondary-foreground hover:bg-hover">
                {t("showAll")}
              </button>
              <button type="button" onClick={hideAll} className="rounded-md border border-border px-2 py-1 text-xs font-medium text-secondary-foreground hover:bg-hover">
                {t("hideAll")}
              </button>
            </div>
            {positions.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {positions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onlyPosition(p)}
                    className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground hover:bg-hover"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            <ul className="mt-2 max-h-72 overflow-y-auto">
              {list.map((s) => (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={!hidden.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="h-4 w-4 accent-rose-600"
                    />
                    <span className="truncate text-foreground">{s.name}</span>
                    {s.position && (
                      <span className="ml-auto truncate text-xs text-faint-foreground">{s.position}</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
