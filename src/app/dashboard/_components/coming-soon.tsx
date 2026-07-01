// Placeholder for screens that have a route + sidebar entry but no UI yet.
// Keeps the app shell honest: the nav is real, unbuilt panels say so plainly
// instead of faking data.
export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-500">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <h1 className="mt-5 text-xl font-semibold text-zinc-100">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">{description}</p>
      <span className="mt-5 inline-block rounded-full bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-400">
        Tezliklə
      </span>
    </div>
  );
}
