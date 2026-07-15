"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { intlLocale } from "@/i18n/format";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";
import { ConfirmDialog } from "@/app/[locale]/dashboard/_components/confirm-dialog";
import { ErrorToast } from "@/app/[locale]/dashboard/_components/toast";
import { saveEmployeePay, recordPayout, deletePayout } from "./actions";

// Loose translator type (avoids depending on next-intl's exact generic shape).
type Tr = (key: string, values?: Record<string, string | number>) => string;

export type PayrollRow = {
  id: string;
  name: string;
  position: string | null;
  isActive: boolean;
  baseSalaryMinor: number;
  commissionPct: number;
  completedCount: number;
  revenueMinor: number;
  commissionMinor: number;
  earnedMinor: number;
  paidMinor: number;
};

export type PayoutItem = {
  id: string;
  employeeId: string;
  amountMinor: number;
  note: string | null;
  paidAtIso: string;
};

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ymLabel(ym: string, df: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat(df, { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1, 12)),
  );
}

/** Salary + commission / commission only / salary only / unset. */
function payModelLabel(r: PayrollRow, t: Tr): string {
  if (r.baseSalaryMinor > 0 && r.commissionPct > 0)
    return t("payModel.hybrid", { salary: azn(r.baseSalaryMinor), pct: r.commissionPct });
  if (r.commissionPct > 0) return t("payModel.commissionOnly", { pct: r.commissionPct });
  if (r.baseSalaryMinor > 0) return t("payModel.salaryOnly", { salary: azn(r.baseSalaryMinor) });
  return t("payModel.none");
}

/** Parse an AZN amount ("450" / "450.50" / "450,50") into qəpik, or null. */
function parseAzn(input: string): number | null {
  const v = Number(input.trim().replace(",", "."));
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

export function PayrollManager({
  ym,
  currentYm,
  rows,
  payouts,
}: {
  ym: string;
  currentYm: string;
  rows: PayrollRow[];
  payouts: PayoutItem[];
}) {
  const t = useTranslations("Payroll");
  const df = intlLocale(useLocale());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [payFor, setPayFor] = useState<PayrollRow | null>(null); // pay-model modal
  const [payoutFor, setPayoutFor] = useState<PayrollRow | null>(null); // payout modal
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null); // payout id
  const [toast, setToast] = useState<string | null>(null);

  const payoutsByEmployee = useMemo(() => {
    const m = new Map<string, PayoutItem[]>();
    for (const p of payouts) {
      const arr = m.get(p.employeeId) ?? [];
      arr.push(p);
      m.set(p.employeeId, arr);
    }
    return m;
  }, [payouts]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          earned: acc.earned + r.earnedMinor,
          paid: acc.paid + r.paidMinor,
        }),
        { earned: 0, paid: 0 },
      ),
    [rows],
  );

  function removePayout(id: string) {
    startTransition(async () => {
      const res = await deletePayout(id);
      if (!res.ok) setToast(res.error);
      setConfirmRemove(null);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      {/* Header + month nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-faint-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <Link
            href={`/dashboard/payroll?ay=${shiftYm(ym, -1)}`}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
            aria-label={t("prevMonth")} title={t("prevMonth")}
          >
            ←
          </Link>
          <span className="min-w-[9rem] text-center text-sm font-medium text-secondary-foreground">
            {ymLabel(ym, df)}
          </span>
          <Link
            href={ym < currentYm ? `/dashboard/payroll?ay=${shiftYm(ym, 1)}` : "#"}
            aria-disabled={ym >= currentYm}
            className={
              "rounded-md px-2 py-1 text-sm " +
              (ym < currentYm
                ? "text-muted-foreground hover:bg-hover hover:text-foreground"
                : "pointer-events-none text-faint-foreground")
            }
            aria-label={t("nextMonth")} title={t("nextMonth")}
          >
            →
          </Link>
        </div>
      </div>

      {/* Month totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-faint-foreground">{t("totals.earned")}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{azn(totals.earned)} ₼</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-faint-foreground">{t("totals.paid")}</p>
          <p className="mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-400">{azn(totals.paid)} ₼</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-faint-foreground">{t("totals.balance")}</p>
          <p
            className={
              "mt-1 text-lg font-semibold " +
              (totals.earned - totals.paid > 0 ? "text-amber-700 dark:text-amber-300" : "text-foreground")
            }
          >
            {azn(totals.earned - totals.paid)} ₼
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm font-medium text-secondary-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-faint-foreground">
            {t("emptyBody")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const empPayouts = payoutsByEmployee.get(r.id) ?? [];
            const balance = r.earnedMinor - r.paidMinor;
            return (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {r.name}
                      {!r.isActive && (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-faint-foreground">
                          {t("inactive")}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-faint-foreground">
                      {r.position ? `${r.position} · ` : ""}
                      {payModelLabel(r, t)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => setPayFor(r)}
                      className="rounded-lg border border-border-strong px-2.5 py-1.5 text-xs font-medium text-secondary-foreground transition hover:border-border-strong hover:text-foreground"
                    >
                      {t("changeModel")}
                    </button>
                    <button
                      onClick={() => setPayoutFor(r)}
                      className="rounded-lg bg-rose-500 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-400"
                    >
                      {t("recordPayout")}
                    </button>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  <div>
                    <dt className="text-xs text-faint-foreground">{t("row.completed")}</dt>
                    <dd className="text-secondary-foreground">{r.completedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint-foreground">{t("row.revenue")}</dt>
                    <dd className="text-secondary-foreground">{azn(r.revenueMinor)} ₼</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint-foreground">{t("row.commission")}</dt>
                    <dd className="text-secondary-foreground">{azn(r.commissionMinor)} ₼</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint-foreground">{t("row.earned")}</dt>
                    <dd className="font-medium text-foreground">{azn(r.earnedMinor)} ₼</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint-foreground">{t("row.balance")}</dt>
                    <dd
                      className={
                        "font-medium " +
                        (balance > 0
                          ? "text-amber-700 dark:text-amber-300"
                          : balance < 0
                            ? "text-rose-700 dark:text-rose-400"
                            : "text-emerald-700 dark:text-emerald-400")
                      }
                    >
                      {azn(balance)} ₼
                    </dd>
                  </div>
                </dl>

                {empPayouts.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-border pt-3">
                    {empPayouts.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                      >
                        <span className="min-w-0 truncate">
                          {new Intl.DateTimeFormat(df, {
                            timeZone: "Asia/Baku",
                            day: "numeric",
                            month: "short",
                          }).format(new Date(p.paidAtIso))}
                          {" — "}
                          <span className="text-secondary-foreground">{azn(p.amountMinor)} ₼</span>
                          {p.note ? ` · ${p.note}` : ""}
                        </span>
                        <button
                          onClick={() => setConfirmRemove(p.id)}
                          disabled={pending}
                          className="shrink-0 text-faint-foreground transition hover:text-rose-400"
                          aria-label={t("deletePayout")}
                        >
                          {t("delete")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {payFor && <PayModelModal row={payFor} onClose={() => setPayFor(null)} />}
      {payoutFor && (
        <PayoutModal row={payoutFor} ym={ym} onClose={() => setPayoutFor(null)} />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title={t("deletePayoutTitle")}
          body={t("deletePayoutBody")}
          pending={pending}
          onConfirm={() => removePayout(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}
      {toast && <ErrorToast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// --- Pay-model modal ---------------------------------------------------------

function PayModelModal({ row, onClose }: { row: PayrollRow; onClose: () => void }) {
  const t = useTranslations("Payroll");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [salary, setSalary] = useState(row.baseSalaryMinor > 0 ? azn(row.baseSalaryMinor) : "");
  const [pct, setPct] = useState(row.commissionPct > 0 ? String(row.commissionPct) : "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const baseSalaryMinor = salary.trim() === "" ? 0 : parseAzn(salary);
    const commissionPct = pct.trim() === "" ? 0 : Number(pct.trim());
    if (baseSalaryMinor === null) {
      setError(t("errors.salaryInvalid"));
      return;
    }
    if (!Number.isInteger(commissionPct) || commissionPct < 0 || commissionPct > 100) {
      setError(t("errors.commissionRange"));
      return;
    }
    startTransition(async () => {
      const res = await saveEmployeePay({ employeeId: row.id, baseSalaryMinor, commissionPct });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title={t("payModelTitle", { name: row.name })} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-secondary-foreground">
          {t("payModelModal.salaryLabel")}
          <input
            inputMode="decimal"
            placeholder="0"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            className="rounded-lg border border-border-strong bg-card px-3 py-2 text-foreground focus:border-rose-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-secondary-foreground">
          {t("payModelModal.commissionLabel")}
          <input
            inputMode="numeric"
            placeholder="0"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="rounded-lg border border-border-strong bg-card px-3 py-2 text-foreground focus:border-rose-500 focus:outline-none"
          />
        </label>
        <p className="text-xs text-faint-foreground">
          {t("payModelModal.hint")}
        </p>
        {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        <ModalActions pending={pending} onClose={onClose} submitLabel={t("save")} />
      </form>
    </Modal>
  );
}

// --- Payout modal -------------------------------------------------------------

function PayoutModal({
  row,
  ym,
  onClose,
}: {
  row: PayrollRow;
  ym: string;
  onClose: () => void;
}) {
  const t = useTranslations("Payroll");
  const df = intlLocale(useLocale());
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const balance = row.earnedMinor - row.paidMinor;
  const [amount, setAmount] = useState(balance > 0 ? azn(balance) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountMinor = parseAzn(amount);
    if (amountMinor === null || amountMinor <= 0) {
      setError(t("errors.amountInvalid"));
      return;
    }
    startTransition(async () => {
      const res = await recordPayout({
        employeeId: row.id,
        periodYm: ym,
        amountMinor,
        note: note.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal title={t("payoutTitle", { name: row.name, month: ymLabel(ym, df) })} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("payoutModal.earnedLabel")}: <span className="text-foreground">{azn(row.earnedMinor)} ₼</span> · {t("payoutModal.paidLabel")}:{" "}
          <span className="text-foreground">{azn(row.paidMinor)} ₼</span> · {t("payoutModal.balanceLabel")}:{" "}
          <span className={balance > 0 ? "text-amber-700 dark:text-amber-300" : "text-foreground"}>
            {azn(balance)} ₼
          </span>
        </p>
        <label className="flex flex-col gap-1 text-sm text-secondary-foreground">
          {t("payoutModal.amount")}
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-lg border border-border-strong bg-card px-3 py-2 text-foreground focus:border-rose-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-secondary-foreground">
          {t("payoutModal.note")}
          <input
            maxLength={300}
            placeholder={t("payoutModal.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-lg border border-border-strong bg-card px-3 py-2 text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        <ModalActions pending={pending} onClose={onClose} submitLabel={t("payoutModal.submit")} />
      </form>
    </Modal>
  );
}

// --- Shared modal shell --------------------------------------------------------

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({
  pending,
  onClose,
  submitLabel,
}: {
  pending: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  const tc = useTranslations("Common");
  return (
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
        {pending ? tc("pleaseWait") : submitLabel}
      </button>
    </div>
  );
}
