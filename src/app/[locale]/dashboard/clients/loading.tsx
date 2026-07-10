import { Skeleton, SkeletonCard } from "../_components/skeleton";

// Clients list skeleton: header + search on the right, then table-shaped rows.
export default function ClientsLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-52" />
        </div>
        <Skeleton className="h-9 w-full sm:w-72" />
      </div>

      <SkeletonCard className="p-0">
        <div className="border-b border-zinc-800 px-4 py-3">
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="divide-y divide-zinc-800/60">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="hidden h-4 w-16 sm:block" />
              <Skeleton className="hidden h-4 w-24 md:block" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}
