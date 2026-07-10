import { Skeleton, SkeletonCard } from "./_components/skeleton";

// Calendar route skeleton: toolbar (period label + view toggle + nav) above
// employee columns with a few appointment-shaped blocks.
export default function CalendarLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((col) => (
          <SkeletonCard key={col} className="p-3">
            <Skeleton className="mx-auto h-4 w-24" />
            <div className="mt-4 space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full opacity-70" />
              <Skeleton className="h-16 w-full opacity-40" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
