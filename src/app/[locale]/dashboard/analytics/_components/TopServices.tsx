// Top revenue services this month, with a horizontal bar per row (top row full
// rose, the rest muted rose). Spans two columns on lg. Empty salons get a
// graceful "Hələ məlumat yoxdur" instead of a bare card.
import { getTranslations } from "next-intl/server";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";

export type TopServiceRow = {
  name: string;
  count: number;
  revenueMinor: number;
  pct: number; // 0..100, relative to the top row
};

export async function TopServices({ rows }: { rows: TopServiceRow[] }) {
  const t = await getTranslations("Analytics.topServices");
  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
      <h2 className="text-lg font-semibold text-foreground">
        {t("title")}
      </h2>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-faint-foreground">{t("empty")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r, i) => (
            <li key={i}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-secondary-foreground">{r.name}</span>
                <span className="whitespace-nowrap text-sm font-medium text-foreground">
                  {azn(r.revenueMinor)} ₼
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-rose-500/20">
                  <div
                    className={`h-full rounded-full ${i === 0 ? "bg-rose-500" : "bg-rose-500/50"}`}
                    style={{ width: `${r.pct}%` }}
                  />
                </div>
                <span className="whitespace-nowrap text-xs text-faint-foreground">
                  {t("appointments", { count: r.count })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
