// Generic label / big-number / subline / delta stat card. Purely
// presentational — the analytics page computes every number on the server and
// passes plain strings in. No "use client": there is no interactivity here.

type ValueTone = "zinc" | "rose" | "emerald" | "muted";
type SublineTone = "zinc" | "amber";
type DeltaTone = "emerald" | "rose" | "neutral";

export type Delta = { text: string; tone: DeltaTone };

const VALUE_TONE: Record<ValueTone, string> = {
  zinc: "text-foreground",
  rose: "text-rose-700 dark:text-rose-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  muted: "text-faint-foreground",
};

const SUBLINE_TONE: Record<SublineTone, string> = {
  zinc: "text-muted-foreground",
  amber: "text-amber-700 dark:text-amber-300",
};

const DELTA_TONE: Record<DeltaTone, string> = {
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rose: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  neutral: "bg-secondary text-secondary-foreground",
};

export function StatCard({
  label,
  value,
  valueTone = "zinc",
  subline,
  sublineTone = "zinc",
  delta,
  className,
}: {
  label: string;
  value: string;
  valueTone?: ValueTone;
  subline?: string | null;
  sublineTone?: SublineTone;
  delta?: Delta | null;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card p-5${className ? ` ${className}` : ""}`}
    >
      <p className="text-xs font-medium text-faint-foreground">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold sm:text-3xl ${VALUE_TONE[valueTone]}`}>
          {value}
        </span>
        {delta && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${DELTA_TONE[delta.tone]}`}
          >
            {delta.text}
          </span>
        )}
      </div>
      {subline && <p className={`mt-1 text-sm ${SUBLINE_TONE[sublineTone]}`}>{subline}</p>}
    </div>
  );
}
