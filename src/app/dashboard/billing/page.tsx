import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuToday, bakuYmd, formatBakuDate } from "@/lib/time";
import { PLAN_LIMITS } from "@/lib/plans";
import { azn } from "@/app/dashboard/_components/calendar-shared";

export const dynamic = "force-dynamic";

// Manual billing: all payments go through the owner personally. Every CTA opens
// a WhatsApp chat with him (prefilled with the salon name); plans are then
// activated by hand. No online payment, no env var — one fixed support number.
const SUPPORT_WA = "994502990440";

function waLink(message: string): string {
  return `https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent(message)}`;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.57-.085 1.758-.719 2.006-1.413.247-.694.247-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.437-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

type PlanCard = {
  key: "BASIC" | "PRO";
  name: string;
  tagline: string;
  priceMinor: number;
  features: string[];
  highlighted?: boolean;
};

const PLANS: PlanCard[] = [
  {
    key: "BASIC",
    name: "Basic",
    tagline: "Kiçik salonlar üçün",
    priceMinor: PLAN_LIMITS.BASIC.priceMinor,
    features: [
      "Onlayn qeydiyyat linki",
      "Təqvim və görüş idarəetməsi",
      "10 işçiyə qədər",
      "Limitsiz görüş",
      "WhatsApp bildirişləri",
      "ROI analitika paneli",
    ],
  },
  {
    key: "PRO",
    name: "Pro",
    tagline: "Böyüyən və çoxfiliallı salonlar üçün",
    priceMinor: PLAN_LIMITS.PRO.priceMinor,
    highlighted: true,
    features: [
      "Basic-dəki hər şey",
      "Limitsiz işçi",
      "Əməkhaqqı modulu (maaş + komissiya)",
      "Çoxfilial dəstəyi (tezliklə)",
      "Excel ixracı (tezliklə)",
      "İşçi rolları və icazələr (tezliklə)",
    ],
  },
];

export default async function BillingPage() {
  const session = (await getSession())!;

  if (session.isAdmin || !session.salonId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold text-zinc-100">
          {session.isAdmin ? "Platforma idarəetməsi" : "Salon tapılmadı"}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          {session.isAdmin
            ? "Plan və ödəniş salon sahibləri üçündür."
            : "Hesabınıza salon bağlanmayıb. Zəhmət olmasa dəstək ilə əlaqə saxlayın."}
        </p>
      </div>
    );
  }

  const salon = await prisma.salon.findUnique({
    where: { id: session.salonId },
    select: { name: true, account: { select: { subscription: true } } },
  });
  const salonName = salon?.name ?? "Salonum";
  const sub = salon?.account?.subscription ?? null;

  // Trial days-left, Baku-safe (same rule as the analytics nudge).
  let daysLeft: number | null = null;
  if (sub?.trialEndsAt) {
    const [ay, am, ad] = bakuToday().split("-").map(Number);
    const [by, bm, bd] = bakuYmd(sub.trialEndsAt).split("-").map(Number);
    daysLeft = Math.max(
      0,
      Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000),
    );
  }
  const planLabel = sub?.plan === "PRO" ? "Pro" : "Basic";
  const periodEndLabel = sub?.currentPeriodEnd
    ? formatBakuDate(bakuYmd(sub.currentPeriodEnd))
    : null;

  let statusLine: { text: string; tone: "emerald" | "amber" | "rose" } | null = null;
  if (sub?.status === "ACTIVE") {
    statusLine = {
      text: `Aktiv plan: ${planLabel}${periodEndLabel ? ` · növbəti ödəniş ${periodEndLabel}` : ""}`,
      tone: "emerald",
    };
  } else if (sub?.status === "TRIALING" && daysLeft !== null) {
    statusLine =
      daysLeft > 0
        ? {
            text: `Pulsuz sınaq: ${daysLeft} gün qalıb`,
            tone: daysLeft <= 3 ? "rose" : "amber",
          }
        : { text: "Sınaq müddəti bitib — planı aktivləşdirin.", tone: "rose" };
  } else if (sub?.status === "PAST_DUE") {
    statusLine = { text: "Ödəniş gözlənilir — planı aktivləşdirin.", tone: "rose" };
  } else if (sub?.status === "FREE_DOWNGRADED") {
    statusLine = {
      text: "Sınaq müddəti bitib — hesab pulsuz plana keçirilib. Planı aktivləşdirin.",
      tone: "rose",
    };
  }

  const statusToneCls: Record<"emerald" | "amber" | "rose", string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
    amber: "border-amber-500/40 bg-amber-500/5 text-amber-200",
    rose: "border-rose-500/50 bg-rose-500/10 text-rose-200",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Plan və ödəniş</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Planı aktivləşdirmək və ya uzatmaq üçün birbaşa bizə yazın — ödəniş
          şəxsən həyata keçirilir.
        </p>
      </div>

      {statusLine && (
        <div className={`rounded-xl border p-4 text-sm ${statusToneCls[statusLine.tone]}`}>
          {statusLine.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {PLANS.map((p) => (
          <div
            key={p.key}
            className={
              "flex flex-col justify-between rounded-xl border bg-[#0d0d0f] p-5 " +
              (p.highlighted ? "border-rose-500/40" : "border-zinc-800")
            }
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-zinc-100">{p.name}</h2>
                {p.highlighted && (
                  <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300">
                    Tövsiyə olunur
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">{p.tagline}</p>
              <p className="mt-3">
                <span className="text-3xl font-semibold text-zinc-100">{azn(p.priceMinor)} ₼</span>
                <span className="text-sm text-zinc-500"> /ay</span>
              </p>
              <ul className="mt-4 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-zinc-300">
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={waLink(
                `Salam! ${salonName} — SalonBook ${p.name} planını aktivləşdirmək istəyirəm.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500"
            >
              <WhatsAppIcon className="h-4 w-4" />
              {p.name} planını seç
            </a>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
        <div>
          <p className="font-medium text-zinc-100">Sualınız var?</p>
          <p className="mt-0.5 text-sm text-zinc-500">
            Ödəniş üsulları və planlar barədə birbaşa WhatsApp-da yazın.
          </p>
        </div>
        <a
          href={waLink(`Salam! ${salonName} — SalonBook planı barədə sualım var.`)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-[#0b141a] transition hover:brightness-95"
        >
          <WhatsAppIcon className="h-5 w-5" />
          WhatsApp-da yazın
        </a>
      </div>
    </div>
  );
}
