import { Skeleton } from "./_components/skeleton";

// Today ("Bu gün") route skeleton: header + a few appointment-row cards.
export default function TodayLoading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 space-y-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <div className="w-14 space-y-2 text-center">
                <Skeleton className="mx-auto h-5 w-10" />
                <Skeleton className="mx-auto h-3 w-8" />
              </div>
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-20" />
              <Skeleton className="ml-auto h-9 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
