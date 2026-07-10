import { Skeleton, SkeletonCard } from "../_components/skeleton";

// Analytics skeleton: hero value block, nudge strip, stat-card grid, wide card.
export default function AnalyticsLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <SkeletonCard className="p-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-8 w-72 max-w-full" />
        <Skeleton className="mt-2 h-4 w-52" />
      </SkeletonCard>

      <Skeleton className="h-12 w-full rounded-xl" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-2 h-3 w-28" />
          </SkeletonCard>
        ))}
      </div>

      <SkeletonCard className="p-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-14" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}
