"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { activateSubscription } from "./actions";

export type AccountRow = {
  accountId: string;
  accountName: string;
  salonName: string;
  slug: string | null;
  ownerEmail: string;
  createdLabel: string;
  plan: string;
  effective: string;
  status: string | null;
  trialEndsLabel: string | null;
  periodEndLabel: string | null;
  bookingsThisMonth: number;
  payments: { id: string; label: string }[];
};

const STATUS_CHIP: Record<string, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-400",
  TRIALING: "bg-sky-500/10 text-sky-300",
  PAST_DUE: "bg-rose-500/10 text-rose-300",
  CANCELLED: "bg-zinc-800 text-zinc-500",
  FREE_DOWNGRADED: "bg-amber-500/10 text-amber-300",
};

export function AdminAccounts({ rows }: { rows: AccountRow[] }) {
  const t = useTranslations("Admin");
  const [activateFor, setActivateFor] = useState<AccountRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          {t("subtitle", { count: rows.length })}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-10 text-center text-sm text-zinc-500">
          {t("noAccounts")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#0d0d0f]">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                <th className="px-4 py-3 font-medium">{t("colSalon")}</th>
                <th className="px-4 py-3 font-medium">{t("colOwner")}</th>
                <th className="px-4 py-3 font-medium">{t("colPlan")}</th>
                <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-4 py-3 font-medium">{t("colEnds")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("colBookings")}</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RowGroup
                  key={r.accountId}
                  row={r}
                  expanded={expanded === r.accountId}
                  onToggle={() =>
                    setExpanded(expanded === r.accountId ? null : r.accountId)
                  }
                  onActivate={() => setActivateFor(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activateFor && (
        <ActivateModal row={activateFor} onClose={() => setActivateFor(null)} />
      )}
    </div>
  );
}

function RowGroup({
  row: r,
  expanded,
  onToggle,
  onActivate,
}: {
  row: AccountRow;
  expanded: boolean;
  onToggle: () => void;
  onActivate: () => void;
}) {
  const t = useTranslations("Admin");
  return (
    <>
      <tr className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-900/40">
        <td className="px-4 py-3">
          <p className="font-medium text-zinc-100">{r.salonName}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {r.slug ? (
              <a href={`/${r.slug}`} target="_blank" className="hover:text-zinc-300">
                /{r.slug}
              </a>
            ) : (
              "—"
            )}
            {" · "}
            {r.createdLabel}
          </p>
        </td>
        <td className="px-4 py-3 text-zinc-300">{r.ownerEmail}</td>
        <td className="px-4 py-3">
          <span className="text-zinc-200">{r.plan}</span>
          {r.effective !== r.plan && (
            <span className="ml-1.5 text-xs text-amber-400" title={t("effectiveTooltip")}>
              → {r.effective}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {r.status ? (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[r.status] ?? "bg-zinc-800 text-zinc-400"}`}
            >
              {t.has(`subStatus.${r.status}`) ? t(`subStatus.${r.status}`) : r.status}
            </span>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-zinc-400">
          {r.status === "TRIALING" ? (r.trialEndsLabel ?? "—") : (r.periodEndLabel ?? "—")}
        </td>
        <td className="px-4 py-3 text-right text-zinc-200">{r.bookingsThisMonth}</td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-2">
            <button
              onClick={onToggle}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition hover:border-zinc-500"
            >
              {expanded ? t("close") : t("payments")}
            </button>
            <button
              onClick={onActivate}
              className="rounded-lg bg-rose-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-rose-400"
            >
              {t("activate")}
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-800/60 bg-zinc-900/30">
          <td colSpan={7} className="px-4 py-3">
            <p className="text-xs font-medium text-zinc-500">{t("recentPayments")}</p>
            {r.payments.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500">{t("noPayments")}</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm text-zinc-300">
                {r.payments.map((p) => (
                  <li key={p.id}>{p.label}</li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ActivateModal({ row, onClose }: { row: AccountRow; onClose: () => void }) {
  const t = useTranslations("Admin");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [plan, setPlan] = useState<"BASIC" | "PRO">(row.plan === "PRO" ? "PRO" : "BASIC");
  const [months, setMonths] = useState("1");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const m = Number(months);
    if (!Number.isInteger(m) || m < 1 || m > 24) return setError(t("errMonthsRange"));
    let amountMinor: number | null = null;
    if (amount.trim() !== "") {
      const v = Number(amount.trim().replace(",", "."));
      if (!Number.isFinite(v) || v < 0) return setError(t("errAmountInvalid"));
      amountMinor = Math.round(v * 100);
    }
    startTransition(async () => {
      const res = await activateSubscription({
        accountId: row.accountId,
        plan,
        months: m,
        amountMinor,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  const inputCls =
    "rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-[#0d0d0f] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-100">
          {t("activateTitle", { name: r_name(row) })}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {t("activateNote", {
            from: row.status === "ACTIVE" ? t("fromExisting") : t("fromToday"),
          })}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">{t("planLabel")}</label>
              <select
                className={inputCls + " w-full [color-scheme:dark]"}
                value={plan}
                onChange={(e) => setPlan(e.target.value as "BASIC" | "PRO")}
              >
                <option value="BASIC">Basic</option>
                <option value="PRO">Pro</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">{t("monthsLabel")}</label>
              <input
                className={inputCls + " w-full"}
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value.replace(/\D/g, "").slice(0, 2))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                {t("amountLabel")}
              </label>
              <input
                className={inputCls + " w-full"}
                inputMode="decimal"
                placeholder={t("amountPlaceholder")}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500"
            >
              {tc("cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
            >
              {pending ? tc("pleaseWait") : t("confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function r_name(r: AccountRow): string {
  return r.salonName !== "—" ? r.salonName : r.accountName;
}
