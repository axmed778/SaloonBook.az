// Pulsing placeholder block for the dashboard route skeletons (loading.tsx).
// Dashboard-only on purpose: it hardcodes the shell's zinc palette, like the
// rest of the dashboard chrome.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-800/60 ${className}`} />;
}

/** Card-shaped skeleton with the dashboard's standard border/background. */
export function SkeletonCard({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4 ${className}`}>
      {children}
    </div>
  );
}
