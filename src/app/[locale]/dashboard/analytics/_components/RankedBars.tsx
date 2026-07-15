// Generic ranked list with proportional bars, used for the all-time "top
// customers by visits" and "most-booked masters" leaderboards. Each row's value
// is a pre-formatted display string; pct sizes the bar relative to the leader.
export type RankRow = {
  key: string;
  label: string;
  value: string;
  pct: number;
};

export function RankedBars({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: RankRow[];
  empty: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-medium text-secondary-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-faint-foreground">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r, i) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-secondary-foreground">
                  <span className="text-faint-foreground">{i + 1}. </span>
                  {r.label}
                </span>
                <span className="shrink-0 text-xs font-medium text-secondary-foreground">{r.value}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-secondary">
                <div className="h-full rounded-full bg-rose-500" style={{ width: `${r.pct}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
