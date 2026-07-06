// Conversion hero: names the felt outcome (self-service online bookings) before
// the number, then the money value, then the "×the plan price" multiplier.
// Brand-new salons (count === 0) get a warm empty state instead of "0 ₼".
import Link from "next/link";
import { azn } from "@/app/dashboard/_components/calendar-shared";

export function HeroValue({
  monthLabel,
  count,
  valueMinor,
  basicPriceMinor,
  bookingHref,
}: {
  monthLabel: string; // already uppercased Baku month label, e.g. "İYUL 2026"
  count: number;
  valueMinor: number;
  basicPriceMinor: number;
  bookingHref: string;
}) {
  const isEmpty = count === 0;
  const mult = Math.floor(valueMinor / basicPriceMinor);

  return (
    <section className="rounded-2xl border border-rose-500/30 bg-gradient-to-b from-rose-500/10 to-[#0d0d0f] p-6 sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {monthLabel} · SALONBOOK-UN GƏTİRDİYİ
      </p>

      {isEmpty ? (
        <div className="mt-3">
          <h1 className="text-2xl font-semibold text-zinc-100">
            İlk onlayn görüşünüzü gözləyirik
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Onlayn qeydiyyat linkinizi müştərilərlə paylaşın — hər görüş burada görünəcək.
          </p>
          <Link
            href={bookingHref}
            className="mt-4 inline-flex items-center rounded-lg border border-rose-500/50 px-4 py-2 text-sm font-medium text-rose-400 transition hover:bg-rose-500/10"
          >
            Qeydiyyat linkini paylaş
          </Link>
        </div>
      ) : (
        <>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-zinc-100 sm:text-4xl">
            SalonBook bu ay sizə <span className="text-rose-400">{count}</span> onlayn görüş
            qazandırdı
          </h1>
          <p className="mt-3 text-2xl font-semibold text-rose-400">
            Ümumi dəyəri {azn(valueMinor)} ₼
          </p>
          {valueMinor >= 2 * basicPriceMinor ? (
            <p className="mt-2 text-sm text-zinc-400">
              Bu, Basic planın qiymətindən ({azn(basicPriceMinor)} ₼/ay) {mult}× çoxdur.
            </p>
          ) : valueMinor >= basicPriceMinor ? (
            <p className="mt-2 text-sm text-zinc-400">
              Bu, Basic planın ({azn(basicPriceMinor)} ₼/ay) qiymətini artıqlaması ilə örtür.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
