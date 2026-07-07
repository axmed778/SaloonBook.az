"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { azn } from "@/app/dashboard/_components/calendar-shared";
import { saveEmployeePay, recordPayout, deletePayout } from "./actions";

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

function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("az-AZ", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1, 12)),
  );
}

/** "500 ₼ + 30%" / "30% komissiya" / "500 ₼ maaş" / "təyin edilməyib" */
function payModelLabel(r: PayrollRow): string {
  if (r.baseSalaryMinor > 0 && r.commissionPct > 0)
    return `${azn(r.baseSalaryMinor)} ₼ maaş + ${r.commissionPct}%`;
  if (r.commissionPct > 0) return `${r.commissionPct}% komissiya`;
  if (r.baseSalaryMinor > 0) return `${azn(r.baseSalaryMinor)} ₼ maaş`;
  return "təyin edilməyib";
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [payFor, setPayFor] = useState<PayrollRow | null>(null); // pay-model modal
  const [payoutFor, setPayoutFor] = useState<PayrollRow | null>(null); // payout modal

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
    if (!confirm("Bu ödəniş qeydini silmək istəyirsiniz?")) return;
    startTransition(async () => {
      const res = await deletePayout(id);
      if (!res.ok) alert(res.error);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      {/* Header + month nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Əməkhaqqı</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Maaş + komissiya hesablanması və ödənişlərin qeydiyyatı.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 p-1">
          <Link
            href={`/dashboard/payroll?ay=${shiftYm(ym, -1)}`}
            className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Əvvəlki ay"
          >
            ←
          </Link>
          <span className="min-w-[9rem] text-center text-sm font-medium text-zinc-200">
            {ymLabel(ym)}
          </span>
          <Link
            href={ym < currentYm ? `/dashboard/payroll?ay=${shiftYm(ym, 1)}` : "#"}
            aria-disabled={ym >= currentYm}
            className={
              "rounded-md px-2 py-1 text-sm " +
              (ym < currentYm
                ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                : "pointer-events-none text-zinc-700")
            }
            aria-label="Növbəti ay"
          >
            →
          </Link>
        </div>
      </div>

      {/* Month totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4">
          <p className="text-xs text-zinc-500">Hesablanmış (bu ay)</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{azn(totals.earned)} ₼</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4">
          <p className="text-xs text-zinc-500">Ödənilmiş</p>
          <p className="mt-1 text-lg font-semibold text-emerald-400">{azn(totals.paid)} ₼</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4">
          <p className="text-xs text-zinc-500">Qalıq</p>
          <p
            className={
              "mt-1 text-lg font-semibold " +
              (totals.earned - totals.paid > 0 ? "text-amber-300" : "text-zinc-100")
            }
          >
            {azn(totals.earned - totals.paid)} ₼
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-8 text-center">
          <p className="text-sm font-medium text-zinc-300">Hələ işçi yoxdur</p>
          <p className="mt-1 text-sm text-zinc-500">
            Əvvəlcə İşçilər bölməsindən işçi əlavə edin.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const empPayouts = payoutsByEmployee.get(r.id) ?? [];
            const balance = r.earnedMinor - r.paidMinor;
            return (
              <li key={r.id} className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {r.name}
                      {!r.isActive && (
                        <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
                          deaktiv
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {r.position ? `${r.position} · ` : ""}
                      {payModelLabel(r)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => setPayFor(r)}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                    >
                      Modeli dəyiş
                    </button>
                    <button
                      onClick={() => setPayoutFor(r)}
                      className="rounded-lg bg-rose-500 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-400"
                    >
                      Ödəniş qeyd et
                    </button>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  <div>
                    <dt className="text-xs text-zinc-500">Tamamlanmış görüş</dt>
                    <dd className="text-zinc-200">{r.completedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Gəlir</dt>
                    <dd className="text-zinc-200">{azn(r.revenueMinor)} ₼</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Komissiya</dt>
                    <dd className="text-zinc-200">{azn(r.commissionMinor)} ₼</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Hesablanmış</dt>
                    <dd className="font-medium text-zinc-100">{azn(r.earnedMinor)} ₼</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Qalıq</dt>
                    <dd
                      className={
                        "font-medium " +
                        (balance > 0
                          ? "text-amber-300"
                          : balance < 0
                            ? "text-rose-400"
                            : "text-emerald-400")
                      }
                    >
                      {azn(balance)} ₼
                    </dd>
                  </div>
                </dl>

                {empPayouts.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-zinc-800/70 pt-3">
                    {empPayouts.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 text-xs text-zinc-400"
                      >
                        <span className="min-w-0 truncate">
                          {new Intl.DateTimeFormat("az-AZ", {
                            timeZone: "Asia/Baku",
                            day: "numeric",
                            month: "short",
                          }).format(new Date(p.paidAtIso))}
                          {" — "}
                          <span className="text-zinc-200">{azn(p.amountMinor)} ₼</span>
                          {p.note ? ` · ${p.note}` : ""}
                        </span>
                        <button
                          onClick={() => removePayout(p.id)}
                          disabled={pending}
                          className="shrink-0 text-zinc-600 transition hover:text-rose-400"
                          aria-label="Ödənişi sil"
                        >
                          Sil
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
    </div>
  );
}

// --- Pay-model modal ---------------------------------------------------------

function PayModelModal({ row, onClose }: { row: PayrollRow; onClose: () => void }) {
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
      setError("Maaş məbləği düzgün deyil.");
      return;
    }
    if (!Number.isInteger(commissionPct) || commissionPct < 0 || commissionPct > 100) {
      setError("Komissiya 0–100 arası tam ədəd olmalıdır.");
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
    <Modal title={`Maaş modeli — ${row.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Aylıq maaş (₼)
          <input
            inputMode="decimal"
            placeholder="0"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-rose-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Komissiya (tamamlanmış görüşlərin gəlirindən %)
          <input
            inputMode="numeric"
            placeholder="0"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-rose-500 focus:outline-none"
          />
        </label>
        <p className="text-xs text-zinc-500">
          Yalnız maaş üçün faizi boş saxlayın; yalnız komissiya üçün maaşı boş saxlayın;
          hibrid üçün hər ikisini doldurun.
        </p>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <ModalActions pending={pending} onClose={onClose} submitLabel="Yadda saxla" />
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
      setError("Məbləğ düzgün deyil.");
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
    <Modal title={`Ödəniş — ${row.name} (${ymLabel(ym)})`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-zinc-400">
          Hesablanmış: <span className="text-zinc-100">{azn(row.earnedMinor)} ₼</span> · Ödənilmiş:{" "}
          <span className="text-zinc-100">{azn(row.paidMinor)} ₼</span> · Qalıq:{" "}
          <span className={balance > 0 ? "text-amber-300" : "text-zinc-100"}>
            {azn(balance)} ₼
          </span>
        </p>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Məbləğ (₼)
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-rose-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Qeyd (istəyə bağlı)
          <input
            maxLength={300}
            placeholder="məs., nağd / kart"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <ModalActions pending={pending} onClose={onClose} submitLabel="Qeyd et" />
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
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#101012] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
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
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500"
      >
        Ləğv et
      </button>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
      >
        {pending ? "Gözləyin…" : submitLabel}
      </button>
    </div>
  );
}
