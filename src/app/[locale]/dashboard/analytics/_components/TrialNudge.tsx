// Compact trial/plan strip under the header: a single slim row with the
// countdown and a small CTA, escalating urgency (border + count colour) as the
// trial ends. Every branch is null-safe.
import Link from "next/link";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";
import { PLAN_LIMITS } from "@/lib/plans";

const BILLING_HREF = "/dashboard/billing";

function Cta({ children }: { children: string }) {
  return (
    <Link
      href={BILLING_HREF}
      className="inline-flex shrink-0 items-center rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400"
    >
      {children}
    </Link>
  );
}

export function TrialNudge({
  status,
  daysLeft,
  planPriceMinor,
  planLabel,
  periodEndLabel,
}: {
  status: string | null;
  daysLeft: number | null;
  planPriceMinor: number;
  planLabel: string;
  periodEndLabel: string | null;
}) {
  const price = `${azn(planPriceMinor || PLAN_LIMITS.BASIC.priceMinor)} ₼`;

  // Active plan — quiet strip, no CTA.
  if (status === "ACTIVE") {
    return (
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-zinc-300">
        Aktiv plan: <span className="font-medium text-zinc-100">{planLabel}</span>
        {periodEndLabel ? ` · növbəti ödəniş ${periodEndLabel}` : ""}
      </section>
    );
  }

  // Expired trial (live or already swept to FREE_DOWNGRADED) or unpaid subscription.
  if (
    (status === "TRIALING" && daysLeft === 0) ||
    status === "PAST_DUE" ||
    status === "FREE_DOWNGRADED"
  ) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3">
        <p className="text-sm text-rose-200">Sınaq müddəti bitib — planı aktivləşdirin.</p>
        <Cta>Aktivləşdir</Cta>
      </section>
    );
  }

  // Trialing with days remaining — escalating urgency.
  if (status === "TRIALING" && daysLeft !== null && daysLeft > 0) {
    const tone =
      daysLeft > 14
        ? { border: "border-zinc-800", count: "text-zinc-200" }
        : daysLeft >= 4
          ? { border: "border-amber-500/40", count: "text-amber-300" }
          : { border: "border-rose-500/50 bg-rose-500/10", count: "text-rose-400" };

    return (
      <section
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border ${tone.border} px-4 py-3`}
      >
        <p className="text-sm text-zinc-300">
          Sınaq <span className={`font-semibold ${tone.count}`}>{daysLeft}</span> gün sonra bitir
          · cəmi {price}/ay
        </p>
        <Cta>Planı aktivləşdir</Cta>
      </section>
    );
  }

  // No subscription / no trial end — generic strip.
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 px-4 py-3">
      <p className="text-sm text-zinc-400">
        Planı aktivləşdirərək bütün funksiyaları açıq saxlayın.
      </p>
      <Cta>Planlara bax</Cta>
    </section>
  );
}
