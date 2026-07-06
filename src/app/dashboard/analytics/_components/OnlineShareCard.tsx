// Share of this month's bookings the customer made themselves (source=PUBLIC) —
// the core "this wouldn't exist without SalonBook" argument. share === null when
// there are no bookings yet (guards divide-by-zero upstream).

export function OnlineShareCard({
  share,
  publicCount,
  totalCount,
}: {
  share: number | null;
  publicCount: number;
  totalCount: number;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
      <p className="text-xs font-medium text-zinc-500">Onlayn pay</p>
      <p className="mt-2 text-2xl font-semibold text-rose-400 sm:text-3xl">
        {share === null ? "—" : `${share}%`}
      </p>
      {share !== null && (
        <div className="mt-2 h-1.5 w-full rounded-full bg-rose-500/20">
          <div className="h-full rounded-full bg-rose-500" style={{ width: `${share}%` }} />
        </div>
      )}
      <p className="mt-2 text-sm text-zinc-400">
        {publicCount} onlayn / {totalCount} ümumi görüş
      </p>
    </div>
  );
}
