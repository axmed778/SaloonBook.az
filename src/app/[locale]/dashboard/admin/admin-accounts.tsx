"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { EXTRA_BRANCH_PRICE_MINOR } from "@/lib/plans";
import {
  activateSubscription,
  setExtraBranches,
  setWhatsAppSender,
  disableWhatsAppSender,
} from "./actions";

export type AccountRow = {
  accountId: string;
  accountName: string;
  salonId: string | null;
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
  /** Paid extra branch slots on top of the plan's base limit. */
  extraBranches: number;
  /** Non-deleted branches the account currently has. */
  branchCount: number;
  /** Effective total branch limit (plan base + extras). */
  branchLimit: number;
  /** Own-number WhatsApp sender: PLATFORM_DEFAULT | PENDING | ACTIVE | DISABLED, or null. */
  senderStatus: string | null;
  senderVerifiedName: string | null;
  senderPhoneMasked: string | null;
  /** Whether the effective plan (Pro) entitles this salon to its own number. */
  ownNumberEligible: boolean;
  payments: { id: string; label: string }[];
};

const STATUS_CHIP: Record<string, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  TRIALING: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  PAST_DUE: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  CANCELLED: "bg-secondary text-faint-foreground",
  FREE_DOWNGRADED: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export function AdminAccounts({ rows }: { rows: AccountRow[] }) {
  const t = useTranslations("Admin");
  const [activateFor, setActivateFor] = useState<AccountRow | null>(null);
  const [branchesFor, setBranchesFor] = useState<AccountRow | null>(null);
  const [senderFor, setSenderFor] = useState<AccountRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-faint-foreground">
          {t("subtitle", { count: rows.length })}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-faint-foreground">
          {t("noAccounts")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-faint-foreground">
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
                  onBranches={() => setBranchesFor(r)}
                  onSender={() => setSenderFor(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activateFor && (
        <ActivateModal row={activateFor} onClose={() => setActivateFor(null)} />
      )}
      {branchesFor && (
        <ExtraBranchesModal row={branchesFor} onClose={() => setBranchesFor(null)} />
      )}
      {senderFor && (
        <WhatsAppSenderModal row={senderFor} onClose={() => setSenderFor(null)} />
      )}
    </div>
  );
}

function RowGroup({
  row: r,
  expanded,
  onToggle,
  onActivate,
  onBranches,
  onSender,
}: {
  row: AccountRow;
  expanded: boolean;
  onToggle: () => void;
  onActivate: () => void;
  onBranches: () => void;
  onSender: () => void;
}) {
  const t = useTranslations("Admin");
  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-hover">
        <td className="px-4 py-3">
          <p className="font-medium text-foreground">{r.salonName}</p>
          <p className="mt-0.5 text-xs text-faint-foreground">
            {r.slug ? (
              <a href={`/${r.slug}`} target="_blank" className="hover:text-secondary-foreground">
                /{r.slug}
              </a>
            ) : (
              "—"
            )}
            {" · "}
            {r.createdLabel}
          </p>
        </td>
        <td className="px-4 py-3 text-secondary-foreground">{r.ownerEmail}</td>
        <td className="px-4 py-3">
          <span className="text-secondary-foreground">{r.plan}</span>
          {r.effective !== r.plan && (
            <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-400" title={t("effectiveTooltip")}>
              → {r.effective}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {r.status ? (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[r.status] ?? "bg-secondary text-muted-foreground"}`}
            >
              {t.has(`subStatus.${r.status}`) ? t(`subStatus.${r.status}`) : r.status}
            </span>
          ) : (
            <span className="text-faint-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          {r.status === "TRIALING" ? (r.trialEndsLabel ?? "—") : (r.periodEndLabel ?? "—")}
        </td>
        <td className="px-4 py-3 text-right text-secondary-foreground">{r.bookingsThisMonth}</td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-2">
            <button
              onClick={onToggle}
              className="rounded-lg border border-border-strong px-2.5 py-1 text-xs text-secondary-foreground transition hover:border-border-strong"
            >
              {expanded ? t("close") : t("payments")}
            </button>
            <button
              onClick={onBranches}
              title={t("branchesUsage", { count: r.branchCount, limit: r.branchLimit })}
              className="rounded-lg border border-border-strong px-2.5 py-1 text-xs text-secondary-foreground transition hover:border-border-strong"
            >
              {t("branchesBtn", { count: r.branchCount, limit: r.branchLimit })}
            </button>
            {r.salonId && (
              <button
                onClick={onSender}
                title={t("waSender.buttonTitle")}
                className="rounded-lg border border-border-strong px-2.5 py-1 text-xs text-secondary-foreground transition hover:border-border-strong"
              >
                {t("waSender.button")}
                {r.senderStatus === "ACTIVE" && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
                )}
                {r.senderStatus === "PENDING" && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
                )}
              </button>
            )}
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
        <tr className="border-b border-border bg-muted">
          <td colSpan={7} className="px-4 py-3">
            <p className="text-xs font-medium text-faint-foreground">{t("recentPayments")}</p>
            {r.payments.length === 0 ? (
              <p className="mt-1 text-sm text-faint-foreground">{t("noPayments")}</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm text-secondary-foreground">
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
    "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">
          {t("activateTitle", { name: r_name(row) })}
        </h2>
        <p className="mt-1 text-xs text-faint-foreground">
          {t("activateNote", {
            from: row.status === "ACTIVE" ? t("fromExisting") : t("fromToday"),
          })}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("planLabel")}</label>
              <select
                className={inputCls + " w-full"}
                value={plan}
                onChange={(e) => setPlan(e.target.value as "BASIC" | "PRO")}
              >
                <option value="BASIC">Basic</option>
                <option value="PRO">Pro</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("monthsLabel")}</label>
              <input
                className={inputCls + " w-full"}
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value.replace(/\D/g, "").slice(0, 2))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
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
          {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-secondary-foreground transition hover:border-border-strong"
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

// Grant/revoke paid extra branch slots (each EXTRA_BRANCH_PRICE_MINOR). The
// input is the new TOTAL of extras; raising it records a Payment for the added
// slots (amount overridable for discounts), lowering it records nothing.
function ExtraBranchesModal({ row, onClose }: { row: AccountRow; onClose: () => void }) {
  const t = useTranslations("Admin");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [extras, setExtras] = useState(String(row.extraBranches));
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nextExtras = Number(extras);
  const added = Number.isInteger(nextExtras) ? nextExtras - row.extraBranches : 0;
  const defaultAmount = ((Math.max(0, added) * EXTRA_BRANCH_PRICE_MINOR) / 100).toFixed(2);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!Number.isInteger(nextExtras) || nextExtras < 0 || nextExtras > 50) {
      return setError(t("errExtrasRange"));
    }
    let amountMinor: number | null = null;
    if (amount.trim() !== "") {
      const v = Number(amount.trim().replace(",", "."));
      if (!Number.isFinite(v) || v < 0) return setError(t("errAmountInvalid"));
      amountMinor = Math.round(v * 100);
    }
    startTransition(async () => {
      const res = await setExtraBranches({
        accountId: row.accountId,
        extraBranches: nextExtras,
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
    "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">
          {t("branchesTitle", { name: r_name(row) })}
        </h2>
        <p className="mt-1 text-xs text-faint-foreground">
          {t("branchesUsage", { count: row.branchCount, limit: row.branchLimit })}
          {" · "}
          {t("branchesNote", { price: (EXTRA_BRANCH_PRICE_MINOR / 100).toFixed(0) })}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("extrasLabel")}
              </label>
              <input
                className={inputCls + " w-full"}
                inputMode="numeric"
                value={extras}
                onChange={(e) => setExtras(e.target.value.replace(/\D/g, "").slice(0, 2))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("amountLabel")}
              </label>
              <input
                className={inputCls + " w-full"}
                inputMode="decimal"
                placeholder={added > 0 ? defaultAmount : "0"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-secondary-foreground transition hover:border-border-strong"
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

// Set / activate a salon's OWN WhatsApp number (Pro feature). Saving validates
// the credentials against Meta server-side; ACTIVE means this salon now sends
// from its own number. The access token is write-only here — it's encrypted on
// the server and never sent back to the client.
function WhatsAppSenderModal({ row, onClose }: { row: AccountRow; onClose: () => void }) {
  const t = useTranslations("Admin");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const statusKey = row.senderStatus ?? "PLATFORM_DEFAULT";
  const isActive = statusKey === "ACTIVE";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!row.salonId) return;
    if (phoneNumberId.trim() === "" || accessToken.trim() === "") {
      return setError(t("waSender.errRequired"));
    }
    startTransition(async () => {
      const res = await setWhatsAppSender({
        salonId: row.salonId,
        phoneNumberId: phoneNumberId.trim(),
        accessToken: accessToken.trim(),
        wabaId: wabaId.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  function disable() {
    setError(null);
    if (!row.salonId) return;
    startTransition(async () => {
      const res = await disableWhatsAppSender({ salonId: row.salonId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  const inputCls =
    "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";

  const statusChip: Record<string, string> = {
    ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    DISABLED: "bg-secondary text-faint-foreground",
    PLATFORM_DEFAULT: "bg-secondary text-faint-foreground",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">
          {t("waSender.title", { name: r_name(row) })}
        </h2>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusChip[statusKey] ?? statusChip.PLATFORM_DEFAULT}`}
          >
            {t(`waSender.status.${statusKey}`)}
          </span>
          {isActive && row.senderVerifiedName && (
            <span className="text-xs text-secondary-foreground">
              {row.senderVerifiedName}
              {row.senderPhoneMasked ? ` · ${row.senderPhoneMasked}` : ""}
            </span>
          )}
        </div>

        {!row.ownNumberEligible && (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-800 dark:text-amber-200">
            {t("waSender.notProWarning")}
          </p>
        )}

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("waSender.phoneNumberId")}
            </label>
            <input
              className={inputCls + " w-full"}
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="1234567890"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("waSender.accessToken")}
            </label>
            <input
              type="password"
              autoComplete="off"
              className={inputCls + " w-full"}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={isActive ? t("waSender.tokenSetPlaceholder") : "EAAG..."}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("waSender.wabaId")}
            </label>
            <input
              className={inputCls + " w-full"}
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              placeholder={t("waSender.optional")}
            />
          </div>
          <p className="text-xs text-faint-foreground">{t("waSender.validateNote")}</p>
          {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <div>
              {isActive && (
                <button
                  type="button"
                  onClick={disable}
                  disabled={pending}
                  className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-700 transition hover:bg-rose-500/5 disabled:opacity-60 dark:text-rose-400"
                >
                  {t("waSender.disable")}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-secondary-foreground transition hover:border-border-strong"
              >
                {tc("cancel")}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
              >
                {pending ? tc("pleaseWait") : t("waSender.save")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function r_name(r: AccountRow): string {
  return r.salonName !== "—" ? r.salonName : r.accountName;
}
