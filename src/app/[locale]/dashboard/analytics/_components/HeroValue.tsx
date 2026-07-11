// Compact conversion header: the eyebrow line stays, the rest is a single tight
// stat line (count · value). Brand-new salons (count === 0) get a short prompt
// instead of a bare "0 ₼".
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";

export async function HeroValue({
  monthLabel,
  count,
  valueMinor,
  bookingHref,
}: {
  monthLabel: string; // already uppercased Baku month label, e.g. "İYUL 2026"
  count: number;
  valueMinor: number;
  bookingHref: string;
}) {
  const t = await getTranslations("Analytics");
  return (
    <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {monthLabel} · {t("monthBrought")}
      </p>

      {count === 0 ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-300">
            {t("heroEmpty")}
          </p>
          <Link
            href={bookingHref}
            className="shrink-0 text-sm font-medium text-rose-400 hover:underline"
          >
            {t("shareLink")}
          </Link>
        </div>
      ) : (
        <p className="mt-1.5 text-xl font-semibold text-zinc-100">
          {t.rich("heroLine", {
            count,
            n: (chunks) => <span className="text-rose-400">{chunks}</span>,
          })}
          <span className="text-zinc-600"> · </span>
          <span className="text-rose-400">{azn(valueMinor)} ₼</span>
        </p>
      )}
    </section>
  );
}
