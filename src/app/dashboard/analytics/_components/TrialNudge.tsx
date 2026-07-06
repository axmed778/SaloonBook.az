// Trial-countdown conversion hook, pinned directly beneath the hero. It quotes
// the hero's own delivered value against the plan price at the moment of
// decision, and escalates urgency (border + count colour) as the trial ends.
// Every branch is null-safe — it never prints "NaN gün" or a bare "0 ₼".
import Link from "next/link";
import { azn } from "@/app/dashboard/_components/calendar-shared";
import { PLAN_LIMITS } from "@/lib/plans";

const BILLING_HREF = "/dashboard/billing";

function Cta({ children }: { children: string }) {
  return (
    <Link
      href={BILLING_HREF}
      className="mt-3 inline-flex items-center rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
    >
      {children}
    </Link>
  );
}

export function TrialNudge({
  status,
  daysLeft,
  planPriceMinor,
  heroCount,
  heroValueMinor,
  planLabel,
  periodEndLabel,
  consumedPct,
}: {
  status: string | null;
  daysLeft: number | null;
  planPriceMinor: number;
  heroCount: number;
  heroValueMinor: number;
  planLabel: string;
  periodEndLabel: string | null;
  consumedPct: number;
}) {
  const price = `${azn(planPriceMinor || PLAN_LIMITS.BASIC.priceMinor)} ₼`;
  // No delivered value yet (brand-new salon): quote a forward-looking line
  // instead of a counterproductive "0 ₼ / 0 onlayn görüş".
  const noValue = heroCount === 0;

  // State 2 — expired trial or an unpaid subscription.
  if ((status === "TRIALING" && daysLeft === 0) || status === "PAST_DUE") {
    return (
      <section className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-5">
        <p className="text-sm text-rose-200">
          Sınaq müddəti bitib — planı aktivləşdirin ki, onlayn qeydiyyat açıq qalsın.
        </p>
        <Cta>Planı aktivləşdir</Cta>
      </section>
    );
  }

  // State 3 — active plan: quiet, no pressure.
  if (status === "ACTIVE") {
    return (
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
        <p className="text-sm text-zinc-300">
          Aktiv plan: <span className="font-medium text-zinc-100">{planLabel}</span>
          {periodEndLabel ? ` · növbəti ödəniş ${periodEndLabel}` : ""}
        </p>
      </section>
    );
  }

  // State 1 — trialing with days remaining: escalating urgency.
  if (status === "TRIALING" && daysLeft !== null && daysLeft > 0) {
    const tone =
      daysLeft > 14
        ? { border: "border-zinc-800", count: "text-emerald-400" }
        : daysLeft >= 4
          ? { border: "border-amber-500/40", count: "text-amber-300" }
          : { border: "border-rose-500/50 bg-rose-500/10", count: "text-rose-400" };

    return (
      <section className={`rounded-xl border ${tone.border} p-5`}>
        <p className="font-semibold text-zinc-100">
          Sınaq <span className={tone.count}>{daysLeft}</span> gün sonra bitir
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          {noValue
            ? `Onlayn qeydiyyat linkinizi paylaşın — hər görüş cəmi ${price}/ay-lıq planınıza dəyər qatır.`
            : `Bu ay SalonBook sizə ${azn(heroValueMinor)} ₼ dəyərində ${heroCount} onlayn görüş gətirdi. Bunu davam etdirmək üçün cəmi ${price}/ay.`}
        </p>
        <div className="mt-3 h-1.5 w-full rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-rose-500"
            style={{ width: `${consumedPct}%` }}
          />
        </div>
        <Cta>Planı aktivləşdir</Cta>
      </section>
    );
  }

  // State 4 — no subscription / no trial end: generic value strip, no countdown.
  return (
    <section className="rounded-xl border border-zinc-800 p-5">
      <p className="text-sm text-zinc-400">
        {noValue
          ? "Onlayn qeydiyyat linkinizi paylaşın — planı aktivləşdirərək bütün funksiyaları açıq saxlayın."
          : `SalonBook bu ay sizə ${azn(heroValueMinor)} ₼ dəyərində iş gördü — planı aktivləşdirərək bütün funksiyaları açıq saxlayın.`}
      </p>
      <Cta>Planlara bax</Cta>
    </section>
  );
}
