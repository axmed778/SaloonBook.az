// Compact conversion header: the eyebrow line stays, the rest is a single tight
// stat line (count · value). Brand-new salons (count === 0) get a short prompt
// instead of a bare "0 ₼".
import Link from "next/link";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";

export function HeroValue({
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
  return (
    <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {monthLabel} · SALONBOOK-UN GƏTİRDİYİ
      </p>

      {count === 0 ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-300">
            İlk onlayn görüşünüzü gözləyirik — qeydiyyat linkinizi paylaşın.
          </p>
          <Link
            href={bookingHref}
            className="shrink-0 text-sm font-medium text-rose-400 hover:underline"
          >
            Linki paylaş
          </Link>
        </div>
      ) : (
        <p className="mt-1.5 text-xl font-semibold text-zinc-100">
          Bu ay <span className="text-rose-400">{count}</span> onlayn görüş
          <span className="text-zinc-600"> · </span>
          <span className="text-rose-400">{azn(valueMinor)} ₼</span>
        </p>
      )}
    </section>
  );
}
