"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { SerializedPayments } from "@/lib/serializers/booking";
import { recordPayment, refundPayment, voidPayment } from "../_actions/payments";
import { azn, inputCls, labelCls } from "./calendar-shared";

// The money block inside the appointment popup: what the booking stands at, the
// entries behind it, and — for a login with payments.write — the forms to take,
// refund and undo.
//
// This component is only ever rendered when `payments` is present, and it is
// present only for a viewer the server cleared (payments.read). A master's block
// has no such key, so there is nothing here to hide with a conditional.
//
// `canWrite` hides the forms from FINANCE, which reads the same screen. That is
// a convenience, not the control: every action re-checks payments.write on the
// server, so a posted form from a session without it is refused there.

const METHODS = ["CASH", "CARD", "TERMINAL", "TRANSFER"] as const;
type Method = (typeof METHODS)[number];

const BADGE: Record<SerializedPayments["status"], string> = {
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  partial: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  unpaid: "bg-muted text-muted-foreground",
};

const BTN =
  "inline-flex h-11 items-center justify-center rounded-lg px-3 text-sm font-medium transition disabled:opacity-50";

/** Qəpik <-> the manat string in the form. "12,50" and "12.50" both parse. */
function toMinor(input: string): number | null {
  const cleaned = input.trim().replace(",", ".");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function PaymentSection({
  appointmentId,
  payments,
  canWrite,
}: {
  appointmentId: string;
  payments: SerializedPayments;
  canWrite: boolean;
}) {
  const t = useTranslations("Payments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "record" | "refund">("view");
  const [voidFor, setVoidFor] = useState<string | null>(null);

  // Prefilled with what is left to take, which is the answer nine times in ten.
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [tip, setTip] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [note, setNote] = useState("");
  const [voidReason, setVoidReason] = useState("");

  function open(next: "record" | "refund") {
    setError(null);
    setMode(next);
    setAmount(next === "record" ? (payments.remainingMinor / 100).toFixed(2) : "");
    setDiscount("");
    setTip("");
    setNote("");
  }

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      let res: { ok: true } | { ok: false; error: string } | null;
      try {
        res = await fn();
      } catch {
        // Never reached the server (offline, deploy mid-flight). Unknown outcome
        // is treated as failure: the list is not updated and nothing is claimed.
        res = null;
      }
      if (res?.ok) {
        setMode("view");
        setVoidFor(null);
        router.refresh();
        return;
      }
      setError(res?.ok === false ? res.error : t("errors.network"));
    });
  }

  function submitRecord() {
    const amountMinor = toMinor(amount);
    const discountMinor = toMinor(discount);
    const tipMinor = toMinor(tip);
    if (amountMinor === null || discountMinor === null || tipMinor === null) {
      setError(t("errors.invalidAmount"));
      return;
    }
    run(() =>
      recordPayment({
        appointmentId,
        method,
        amountMinor,
        discountMinor,
        tipMinor,
        note: note || undefined,
      }),
    );
  }

  function submitRefund() {
    const amountMinor = toMinor(amount);
    if (amountMinor === null) {
      setError(t("errors.invalidAmount"));
      return;
    }
    run(() => refundPayment({ appointmentId, method, amountMinor, note: note || undefined }));
  }

  return (
    <div className="mt-4 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-faint-foreground">{t("title")}</p>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[11px] font-medium " + BADGE[payments.status]
          }
        >
          {t(`status.${payments.status}`)}
        </span>
      </div>

      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("received")}</dt>
          <dd className="tabular-nums text-foreground">{azn(payments.netReceivedMinor)} ₼</dd>
        </div>
        {payments.settledMinor !== payments.netReceivedMinor && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("settled")}</dt>
            <dd className="tabular-nums text-foreground">{azn(payments.settledMinor)} ₼</dd>
          </div>
        )}
        {payments.remainingMinor > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("remaining")}</dt>
            <dd className="tabular-nums font-medium text-amber-800 dark:text-amber-200">
              {azn(payments.remainingMinor)} ₼
            </dd>
          </div>
        )}
        {payments.tipsMinor > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("tips")}</dt>
            <dd className="tabular-nums text-foreground">{azn(payments.tipsMinor)} ₼</dd>
          </div>
        )}
      </dl>

      {payments.entries.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-2">
          {payments.entries.map((e) => {
            const voided = e.voidedAt !== null;
            return (
              <li key={e.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={voided ? "text-faint-foreground line-through" : "text-foreground"}>
                    {e.kind === "REFUND" ? "−" : ""}
                    {azn(e.amountMinor)} ₼ · {t(`method.${e.method}`)}
                  </span>
                  {canWrite && !voided && (
                    <button
                      type="button"
                      onClick={() => {
                        setVoidFor(e.id);
                        setVoidReason("");
                        setError(null);
                      }}
                      className="text-rose-700 underline dark:text-rose-400"
                    >
                      {t("voidAction")}
                    </button>
                  )}
                </div>
                <p className="text-faint-foreground">
                  {e.discountMinor > 0 && <>{t("discountOf", { amount: azn(e.discountMinor) })} · </>}
                  {e.tipMinor > 0 && <>{t("tipOf", { amount: azn(e.tipMinor) })} · </>}
                  {e.businessDate}
                  {e.receivedByName ? ` · ${e.receivedByName}` : ""}
                </p>
                {e.note && <p className="text-faint-foreground">{e.note}</p>}
                {voided && e.voidReason && (
                  <p className="text-rose-700 dark:text-rose-400">
                    {t("voidedBecause", { reason: e.voidReason })}
                  </p>
                )}

                {voidFor === e.id && (
                  <div className="mt-1.5 rounded-lg border border-rose-500/40 bg-rose-500/5 p-2">
                    <label className={labelCls} htmlFor={`void-${e.id}`}>
                      {t("voidReason")}
                    </label>
                    <input
                      id={`void-${e.id}`}
                      value={voidReason}
                      onChange={(ev) => setVoidReason(ev.target.value)}
                      className={inputCls + " w-full"}
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={pending || voidReason.trim() === ""}
                        onClick={() => run(() => voidPayment({ paymentId: e.id, reason: voidReason }))}
                        className={BTN + " flex-1 bg-rose-500/15 text-rose-700 dark:text-rose-300"}
                      >
                        {t("confirmVoid")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoidFor(null)}
                        className={BTN + " flex-1 border border-border text-secondary-foreground"}
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

      {canWrite && mode === "view" && (
        <div className="mt-3 flex gap-2">
          {payments.remainingMinor > 0 && (
            <button
              type="button"
              onClick={() => open("record")}
              className={BTN + " flex-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}
            >
              {t("record")}
            </button>
          )}
          {payments.netReceivedMinor > 0 && (
            <button
              type="button"
              onClick={() => open("refund")}
              className={BTN + " flex-1 border border-border text-secondary-foreground"}
            >
              {t("refund")}
            </button>
          )}
        </div>
      )}

      {canWrite && mode !== "view" && (
        <div className="mt-3 space-y-2">
          <div>
            <label className={labelCls} htmlFor="pay-amount">
              {t("amount")}
            </label>
            <input
              id="pay-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls + " w-full"}
            />
          </div>

          {mode === "record" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls} htmlFor="pay-discount">
                  {t("discount")}
                </label>
                <input
                  id="pay-discount"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className={inputCls + " w-full"}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="pay-tip">
                  {t("tip")}
                </label>
                <input
                  id="pay-tip"
                  inputMode="decimal"
                  value={tip}
                  onChange={(e) => setTip(e.target.value)}
                  className={inputCls + " w-full"}
                />
              </div>
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="pay-method">
              {t("methodLabel")}
            </label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as Method)}
              className={inputCls + " w-full"}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`method.${m}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="pay-note">
              {t("note")}
            </label>
            <input
              id="pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputCls + " w-full"}
            />
          </div>

          {/* The price itself is never editable here: a reduction is a discount,
              which is recorded as one so the booking still shows what it cost. */}
          <p className="text-[11px] text-faint-foreground">{t("priceLocked")}</p>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={mode === "record" ? submitRecord : submitRefund}
              className={BTN + " flex-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}
            >
              {mode === "record" ? t("save") : t("confirmRefund")}
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              className={BTN + " flex-1 border border-border text-secondary-foreground"}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
