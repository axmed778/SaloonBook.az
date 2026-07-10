"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Slot } from "@/lib/availability";
import { availableSlots, createManualBooking } from "../actions";
import {
  inputCls,
  labelCls,
  azn,
  type CatalogEmployee,
} from "./calendar-shared";

// Staff-entered ("manual") booking: pick master → service → day → free slot,
// then the customer's name and phone. Slots come from the same availability
// engine the public flow uses, so a manual booking can't double-book either.

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
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [day, setDay] = useState(defaultDay);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState(initialName);
  const [phoneDigits, setPhoneDigits] = useState(initialPhoneDigits);

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const services = catalog.find((e) => e.id === employeeId)?.services ?? [];
  const ready = employeeId && serviceId && day;

  // Load free slots whenever the (employee, service, day) triple is complete.
  useEffect(() => {
    if (!employeeId || !serviceId || !day) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setSlots(null);
    availableSlots({ employeeId, serviceId, day })
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
  }, [employeeId, serviceId, day]);

  function submit() {
    setError(null);
    const digits = phoneDigits.replace(/\D/g, "");
    if (!employeeId || !serviceId) return setError("İşçi və xidmət seçin.");
    if (!slot) return setError("Boş vaxt seçin.");
    if (!name.trim()) return setError("Müştəri adını daxil edin.");
    if (digits.length !== 9) return setError("Telefon +994 və 9 rəqəmdən ibarət olmalıdır.");

    startSubmit(async () => {
      const res = await createManualBooking({
        employeeId,
        serviceId,
        startUtc: slot.startUtc,
        name: name.trim(),
        phone: "+994" + digits,
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
        className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-zinc-800 bg-[#0d0d0f] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">Yeni görüş</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Bağla" title="Bağla"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {/* Master */}
          <div>
            <label className={labelCls}>Mütəxəssis</label>
            <select
              className={inputCls + " w-full [color-scheme:dark]"}
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setServiceId("");
                setSlot(null);
                setError(null);
              }}
            >
              <option value="">Seçin…</option>
              {catalog.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Service */}
          <div>
            <label className={labelCls}>Xidmət</label>
            <select
              className={inputCls + " w-full [color-scheme:dark] disabled:opacity-50"}
              value={serviceId}
              disabled={!employeeId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setSlot(null);
                setError(null);
              }}
            >
              <option value="">
                {employeeId ? "Seçin…" : "Əvvəlcə mütəxəssis seçin"}
              </option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {azn(s.priceMinor)} ₼ · {s.durationMin} dəq
                </option>
              ))}
            </select>
            {employeeId && services.length === 0 && (
              <p className="mt-1 text-xs text-amber-400">
                Bu işçiyə xidmət təyin edilməyib.
              </p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className={labelCls}>Tarix</label>
            <input
              type="date"
              className={inputCls + " w-full [color-scheme:dark]"}
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
            <div>
              <label className={labelCls}>Boş vaxt</label>
              {slotsLoading ? (
                <div className="grid grid-cols-4 gap-2" aria-busy="true">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="h-[34px] animate-pulse rounded-lg bg-zinc-800/60" />
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
                          ? "border-rose-500 bg-rose-500/15 text-rose-100"
                          : "border-zinc-800 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800/60")
                      }
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  Bu gün üçün boş vaxt yoxdur.
                </p>
              )}
            </div>
          )}

          {/* Customer */}
          <div>
            <label className={labelCls}>Müştəri adı</label>
            <input
              className={inputCls + " w-full"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ad Soyad"
            />
          </div>
          <div>
            <label className={labelCls}>Telefon</label>
            <div className="flex items-center gap-2">
              <span className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400">
                +994
              </span>
              <input
                className={inputCls + " w-full"}
                value={phoneDigits}
                inputMode="numeric"
                maxLength={9}
                onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="501234567"
              />
            </div>
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>

        <div className="border-t border-zinc-800 px-5 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            {submitting ? "Yaradılır…" : "Görüşü yarat"}
          </button>
        </div>
      </div>
    </div>
  );
}
