"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useModalA11y } from "@/components/use-modal-a11y";
import type { Slot } from "@/lib/availability";
import { addonTotals } from "@/lib/addons";
import { hasContact } from "@/lib/serializers/redact-notes";
import { availableSlots, createManualBooking } from "../actions";
import {
  inputCls,
  labelCls,
  azn,
  type CatalogEmployee,
} from "./calendar-shared";

// Staff-entered ("manual") booking: pick master → service (+ add-ons) → day →
// free slot, then the customer's name and phone. Slots come from the same
// availability engine the public flow uses, so a manual booking can't
// double-book either.

export function BookingModal({
  catalog,
  defaultDay,
  today,
  onClose,
  initialName = "",
  initialPhoneDigits = "",
}: {
  catalog: CatalogEmployee[];
  defaultDay: string;
  today: string;
  onClose: () => void;
  /** Prefill for the customer fields (used by the Clients CRM profile). */
  initialName?: string;
  initialPhoneDigits?: string;
}) {
  const t = useTranslations("Calendar");
  const tc = useTranslations("Common");
  const router = useRouter();
  const { titleId, dialogProps } = useModalA11y(onClose);
  // One prefix per mounted modal keeps the field ids unique even if two of
  // these ever render at once (Clients CRM opens one over the calendar's).
  const fid = useId();
  const [employeeId, setEmployeeId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [day, setDay] = useState(defaultDay);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState(initialName);
  const [phoneDigits, setPhoneDigits] = useState(initialPhoneDigits);
  const [serviceNote, setServiceNote] = useState("");

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const services = catalog.find((e) => e.id === employeeId)?.services ?? [];
  const selectedService = services.find((s) => s.id === serviceId) ?? null;
  const serviceAddons = selectedService?.addons ?? [];
  const extra = addonTotals(serviceAddons.filter((a) => addonIds.includes(a.id)));
  const ready = employeeId && serviceId && day;
  // A stable dependency for the slots effect: the add-ons lengthen the booking.
  const addonKey = addonIds.join(",");

  function toggleAddon(id: string) {
    setAddonIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    // A longer (or shorter) booking fits different slots.
    setSlot(null);
    setError(null);
  }

  // Load free slots whenever the (employee, service, day) triple is complete.
  useEffect(() => {
    if (!employeeId || !serviceId || !day) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setSlots(null);
    availableSlots({
      employeeId,
      serviceId,
      addonIds: addonKey ? addonKey.split(",") : [],
      day,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setSlots(res.slots);
        else {
          setSlots([]);
          setError(res.error);
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, serviceId, addonKey, day]);

  function submit() {
    setError(null);
    const digits = phoneDigits.replace(/\D/g, "");
    if (!employeeId || !serviceId) return setError(t("modal.errors.selectStaffService"));
    if (!slot) return setError(t("modal.errors.selectSlot"));
    if (!name.trim()) return setError(t("modal.errors.enterCustomerName"));
    if (digits.length !== 9) return setError(t("modal.errors.phoneInvalid"));
    // Duplicate of the server action's rule, for the round trip only — the
    // action refuses a note with a contact in it whatever this form does.
    if (hasContact(serviceNote)) return setError(t("modal.errors.noteContact"));

    startSubmit(async () => {
      const res = await createManualBooking({
        employeeId,
        serviceId,
        addonIds,
        startUtc: slot.startUtc,
        name: name.trim(),
        phone: "+994" + digits,
        serviceNote: serviceNote.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        {...dialogProps}
        className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {t("newBooking")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc("close")} title={tc("close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {/* Master */}
          <div>
            <label className={labelCls} htmlFor={`${fid}-employee`}>
              {t("modal.employee")}
            </label>
            <select
              id={`${fid}-employee`}
              className={inputCls + " w-full"}
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setServiceId("");
                setAddonIds([]);
                setSlot(null);
                setError(null);
              }}
            >
              <option value="">{t("modal.select")}</option>
              {catalog.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Service */}
          <div>
            <label className={labelCls} htmlFor={`${fid}-service`}>
              {t("modal.service")}
            </label>
            <select
              id={`${fid}-service`}
              className={inputCls + " w-full disabled:opacity-50"}
              value={serviceId}
              disabled={!employeeId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setAddonIds([]);
                setSlot(null);
                setError(null);
              }}
            >
              <option value="">
                {employeeId ? t("modal.select") : t("modal.selectStaffFirst")}
              </option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {azn(s.priceMinor)} ₼ · {t("modal.minutesShort", { min: s.durationMin })}
                </option>
              ))}
            </select>
            {employeeId && services.length === 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                {t("modal.noServicesForStaff")}
              </p>
            )}
          </div>

          {/* Add-ons offered with this service: their price and minutes are
              added to the booking (the slots below already account for them). */}
          {selectedService && serviceAddons.length > 0 && (
            <div role="group" aria-labelledby={`${fid}-addons`}>
              <span id={`${fid}-addons`} className={labelCls}>
                {t("modal.addons")}
              </span>
              <div className="space-y-1.5">
                {serviceAddons.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={addonIds.includes(a.id)}
                        onChange={() => toggleAddon(a.id)}
                        className="h-4 w-4 shrink-0 accent-rose-600"
                      />
                      <span className="truncate">{a.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      +{azn(a.priceMinor)} ₼
                      {a.durationMin > 0 && ` · +${t("modal.minutesShort", { min: a.durationMin })}`}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t("modal.total", {
                  price: azn(selectedService.priceMinor + extra.priceMinor),
                  min: selectedService.durationMin + extra.durationMin,
                })}
              </p>
            </div>
          )}

          {/* Date */}
          <div>
            <label className={labelCls} htmlFor={`${fid}-date`}>
              {t("modal.date")}
            </label>
            <input
              id={`${fid}-date`}
              type="date"
              className={inputCls + " w-full"}
              value={day}
              min={today}
              onChange={(e) => {
                setDay(e.target.value);
                setSlot(null);
                setError(null);
              }}
            />
          </div>

          {/* Slots */}
          {ready && (
            <div role="group" aria-labelledby={`${fid}-slots`}>
              <span id={`${fid}-slots`} className={labelCls}>
                {t("modal.freeSlot")}
              </span>
              {slotsLoading ? (
                <div className="grid grid-cols-4 gap-2" aria-busy="true">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="h-[34px] animate-pulse rounded-lg bg-hover" />
                  ))}
                </div>
              ) : slots && slots.length > 0 ? (
                <div className="grid max-h-40 grid-cols-4 gap-2 overflow-y-auto">
                  {slots.map((s) => (
                    <button
                      key={s.startUtc}
                      type="button"
                      onClick={() => setSlot(s)}
                      className={
                        "rounded-lg border px-2 py-1.5 text-sm transition " +
                        (slot?.startUtc === s.startUtc
                          ? "border-rose-500 bg-rose-500/15 text-rose-800 dark:text-rose-100"
                          : "border-border text-secondary-foreground hover:border-border-strong hover:bg-hover")
                      }
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-faint-foreground">
                  {t("modal.noSlots")}
                </p>
              )}
            </div>
          )}

          {/* Customer */}
          <div>
            <label className={labelCls} htmlFor={`${fid}-name`}>
              {t("modal.customerName")}
            </label>
            <input
              id={`${fid}-name`}
              className={inputCls + " w-full"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("modal.namePlaceholder")}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${fid}-phone`}>
              {t("modal.phone")}
            </label>
            <div className="flex items-center gap-2">
              <span className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                +994
              </span>
              <input
                id={`${fid}-phone`}
                className={inputCls + " w-full"}
                value={phoneDigits}
                inputMode="numeric"
                maxLength={9}
                onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="501234567"
              />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor={`${fid}-service-note`}>
              {t("modal.serviceNote")}
            </label>
            <textarea
              id={`${fid}-service-note`}
              className={inputCls + " w-full resize-y"}
              value={serviceNote}
              onChange={(e) => setServiceNote(e.target.value.slice(0, 500))}
              rows={2}
              placeholder={t("modal.serviceNotePlaceholder")}
              aria-describedby={`${fid}-service-note-hint`}
            />
            <p id={`${fid}-service-note-hint`} className="mt-1 text-xs text-faint-foreground">
              {t("modal.serviceNoteHint")}
            </p>
          </div>

          {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        </div>

        <div className="border-t border-border px-5 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:opacity-50"
          >
            {submitting ? t("modal.creating") : t("modal.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
