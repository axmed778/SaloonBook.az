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
    <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
      <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r, i) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-zinc-200">
                  <span className="text-zinc-500">{i + 1}. </span>
                  {r.label}
                </span>
                <span className="shrink-0 text-xs font-medium text-zinc-300">{r.value}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-rose-500" style={{ width: `${r.pct}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
