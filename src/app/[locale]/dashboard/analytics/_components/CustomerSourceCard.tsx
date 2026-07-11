// All-time adoption of online self-booking across the salon's whole client base,
// shown two ways: "ever booked online" (used the service at least once) and
// "acquired online" (their very first booking was online). Manual = the rest.
import { getTranslations } from "next-intl/server";

export async function CustomerSourceCard({
  total,
  everOnline,
  acquiredOnline,
}: {
  total: number;
  everOnline: number;
  acquiredOnline: number;
}) {
  const t = await getTranslations("Analytics.customerSource");
  return (
    <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-300">{t("title")}</h2>
        <span className="text-xs text-zinc-500">{t("totalCustomers", { count: total })}</span>
      </div>

      {total === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("noCustomers")}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <Row label={t("everOnline")} value={everOnline} total={total} manualLabel={t("manualAdded", { count: total - everOnline })} />
          <Row label={t("firstOnline")} value={acquiredOnline} total={total} manualLabel={t("manualAdded", { count: total - acquiredOnline })} />
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  total,
  manualLabel,
}: {
  label: string;
  value: number;
  total: number;
  manualLabel: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300">
          <span className="font-semibold text-rose-400">{value}</span> / {total} · {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-rose-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-zinc-500">{manualLabel}</p>
    </div>
  );
}
