"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveEmployee,
  setEmployeeActive,
  deleteEmployee,
  addTimeOff,
  deleteTimeOff,
} from "./actions";
import { AUDIENCE_LABEL, type Audience } from "@/lib/audience";
import { AudienceSelect } from "../_components/audience-select";
import { ConfirmDialog } from "../_components/confirm-dialog";
import { ErrorToast } from "../_components/toast";

type Svc = { id: string; name: string; isActive: boolean };
type HourRow = { weekday: number; startMin: number; endMin: number };
export type TimeOffRow = { id: string; label: string; reason: string | null };
export type EmployeeRow = {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
  isActive: boolean;
  audience: Audience;
  serviceIds: string[];
  hours: HourRow[];
  timeOff: TimeOffRow[];
};

// weekday: 0=Sunday..6=Saturday (matches the schema + availability engine).
// Displayed Monday-first, as is conventional in Azerbaijan.
const WEEKDAYS: { weekday: number; label: string }[] = [
  { weekday: 1, label: "Bazar ertəsi" },
  { weekday: 2, label: "Çərşənbə axşamı" },
  { weekday: 3, label: "Çərşənbə" },
  { weekday: 4, label: "Cümə axşamı" },
  { weekday: 5, label: "Cümə" },
  { weekday: 6, label: "Şənbə" },
  { weekday: 0, label: "Bazar" },
];

const inputCls =
  "rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

type DayState = { on: boolean; start: string; end: string };
type HoursState = Record<number, DayState>;

function buildHours(existing: HourRow[]): HoursState {
  const state: HoursState = {};
  for (const { weekday } of WEEKDAYS) {
    const found = existing.find((h) => h.weekday === weekday);
    state[weekday] = found
      ? { on: true, start: toHHMM(found.startMin), end: toHHMM(found.endMin) }
      : { on: false, start: "10:00", end: "19:00" };
  }
  return state;
}

// New employee default: Mon–Sat 10:00–19:00, Sunday off.
function defaultHours(): HoursState {
  const state: HoursState = {};
  for (const { weekday } of WEEKDAYS) {
    state[weekday] = { on: weekday !== 0, start: "10:00", end: "19:00" };
  }
  return state;
}

const emptyForm = {
  id: undefined as string | undefined,
  name: "",
  position: "",
  phone: "",
  isActive: true,
  audience: "ALL" as Audience,
};

export function WorkersManager({
  employees,
  services,
}: {
  employees: EmployeeRow[];
  services: Svc[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [hours, setHours] = useState<HoursState>(defaultHours);
  const [error, setError] = useState<string | null>(null);
  const [timeOffFor, setTimeOffFor] = useState<EmployeeRow | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<EmployeeRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const activeServices = services.filter((s) => s.isActive);
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "—";

  function startAdd() {
    setForm(emptyForm);
    setServiceIds([]);
    setHours(defaultHours());
    setError(null);
    setOpen(true);
  }

  function startEdit(e: EmployeeRow) {
    setForm({
      id: e.id,
      name: e.name,
      position: e.position ?? "",
      phone: e.phone ?? "",
      isActive: e.isActive,
      audience: e.audience,
    });
    setServiceIds(e.serviceIds);
    setHours(buildHours(e.hours));
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function toggleService(id: string) {
    setServiceIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  function setDay(weekday: number, patch: Partial<DayState>) {
    setHours((cur) => ({ ...cur, [weekday]: { ...cur[weekday], ...patch } }));
  }

  function submit() {
    if (!form.name.trim()) return setError("Ad tələb olunur.");

    const TIME_RE = /^\d{2}:\d{2}$/;
    const hoursPayload: HourRow[] = [];
    for (const { weekday, label } of WEEKDAYS) {
      const d = hours[weekday];
      if (!d.on) continue;
      // A cleared <input type="time"> reports "" — reject it (and any partial
      // value) explicitly, otherwise toMin() yields NaN and slips past the
      // comparison below.
      if (!TIME_RE.test(d.start) || !TIME_RE.test(d.end)) {
        return setError(`${label}: iş saatlarını doldurun.`);
      }
      const startMin = toMin(d.start);
      const endMin = toMin(d.end);
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        return setError(`${label}: bitmə vaxtı başlanğıcdan sonra olmalıdır.`);
      }
      hoursPayload.push({ weekday, startMin, endMin });
    }

    startTransition(async () => {
      const res = await saveEmployee({
        id: form.id,
        name: form.name.trim(),
        position: form.position.trim() || null,
        phone: form.phone.trim() || null,
        isActive: form.isActive,
        audience: form.audience,
        serviceIds,
        hours: hoursPayload,
      });
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function toggleActive(e: EmployeeRow) {
    startTransition(async () => {
      const res = await setEmployeeActive(e.id, !e.isActive);
      if (!res.ok) setToast(res.error); // e.g. plan seat limit on re-activation
      router.refresh();
    });
  }

  function remove(e: EmployeeRow) {
    startTransition(async () => {
      const res = await deleteEmployee(e.id);
      if (!res.ok) setToast(res.error);
      setConfirmRemove(null);
      router.refresh();
    });
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">İşçilər</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Mütəxəssislər, onların xidmətləri və iş qrafiki.
          </p>
        </div>
        {!open && (
          <button
            onClick={startAdd}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            Yeni işçi
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {open && (
        <div className="mb-6 rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
          <h2 className="text-sm font-semibold text-zinc-100">
            {form.id ? "İşçini redaktə et" : "Yeni işçi"}
          </h2>

          {/* Basic fields */}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Ad</label>
              <input
                className={inputCls + " w-full"}
                placeholder="Ayan"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className={labelCls}>Vəzifə</label>
              <input
                className={inputCls + " w-full"}
                placeholder="Bərbər"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Telefon</label>
              <input
                className={inputCls + " w-full"}
                placeholder="+994..."
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-5">
            <AudienceSelect
              value={form.audience}
              onChange={(a) => setForm({ ...form, audience: a })}
              label="Kimlərlə işləyir"
            />
          </div>

          {/* Services */}
          <div className="mt-5">
            <label className={labelCls}>Xidmətlər</label>
            {activeServices.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Əvvəlcə «Xidmətlər» bölməsindən xidmət əlavə edin.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {activeServices.map((s) => {
                  const on = serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleService(s.id)}
                      className={
                        "rounded-full border px-3 py-1.5 text-sm transition " +
                        (on
                          ? "border-rose-500/50 bg-rose-500/15 text-rose-200"
                          : "border-zinc-800 text-zinc-400 hover:bg-zinc-800/60")
                      }
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Working hours */}
          <div className="mt-5">
            <label className={labelCls}>İş qrafiki</label>
            <div className="space-y-2">
              {WEEKDAYS.map(({ weekday, label }) => {
                const d = hours[weekday];
                return (
                  <div key={weekday} className="flex flex-wrap items-center gap-3">
                    <label className="flex w-40 items-center gap-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={d.on}
                        onChange={(e) => setDay(weekday, { on: e.target.checked })}
                        className="h-4 w-4 accent-rose-500"
                      />
                      {label}
                    </label>
                    {d.on ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          step={900}
                          value={d.start}
                          onChange={(e) => setDay(weekday, { start: e.target.value })}
                          className={inputCls + " [color-scheme:dark]"}
                        />
                        <span className="text-zinc-600">—</span>
                        <input
                          type="time"
                          step={900}
                          value={d.end}
                          onChange={(e) => setDay(weekday, { end: e.target.value })}
                          className={inputCls + " [color-scheme:dark]"}
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-600">İstirahət günü</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active toggle */}
          <label className="mt-5 flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 accent-rose-500"
            />
            Aktiv (təqvimdə və qeydiyyatda görünür)
          </label>

          {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
            >
              {pending ? "Saxlanılır…" : "Saxla"}
            </button>
            <button
              onClick={close}
              disabled={pending}
              className="rounded-lg border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800/60 disabled:opacity-60"
            >
              Ləğv et
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {employees.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 text-center">
          <p className="text-sm font-medium text-zinc-300">Hələ işçi yoxdur</p>
          <p className="mt-1 max-w-xs text-sm text-zinc-500">
            «Yeni işçi» düyməsi ilə ilk mütəxəssisinizi əlavə edin — o, dərhal təqvimdə görünəcək.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {employees.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-[#0d0d0f] px-4 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-zinc-200">
                  {e.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-zinc-100">{e.name}</p>
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                      {AUDIENCE_LABEL[e.audience]}
                    </span>
                    {!e.isActive && (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                        Deaktiv
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-zinc-500">
                    {e.position || "—"}
                    <span className="text-zinc-700"> · </span>
                    {e.serviceIds.length} xidmət
                    <span className="text-zinc-700"> · </span>
                    {e.hours.length} iş günü
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <button
                  onClick={() => setTimeOffFor(e)}
                  disabled={pending}
                  className="text-sm text-zinc-400 transition hover:text-zinc-100 disabled:opacity-60"
                >
                  Məzuniyyət
                  {e.timeOff.length > 0 && (
                    <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-medium text-amber-300">
                      {e.timeOff.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => startEdit(e)}
                  disabled={pending}
                  className="text-sm text-zinc-400 transition hover:text-zinc-100 disabled:opacity-60"
                >
                  Redaktə
                </button>
                <button
                  onClick={() => toggleActive(e)}
                  disabled={pending}
                  className="text-sm text-zinc-400 transition hover:text-zinc-100 disabled:opacity-60"
                >
                  {e.isActive ? "Deaktiv et" : "Aktiv et"}
                </button>
                <button
                  onClick={() => setConfirmRemove(e)}
                  disabled={pending}
                  className="text-sm text-rose-400/80 transition hover:text-rose-400 disabled:opacity-60"
                >
                  Sil
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {timeOffFor && (
        <TimeOffModal
          // Re-resolve from props so the list inside the modal stays fresh
          // after add/delete (router.refresh replaces `employees`).
          employee={employees.find((x) => x.id === timeOffFor.id) ?? timeOffFor}
          onClose={() => setTimeOffFor(null)}
        />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="İşçini sil"
          body={
            <>
              <span className="font-medium text-zinc-200">{confirmRemove.name}</span> silinsin?
              Görüşləri olan işçi silinə bilməz — onu deaktiv edin.
            </>
          }
          pending={pending}
          onConfirm={() => remove(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}
      {toast && <ErrorToast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// --- Time off modal -----------------------------------------------------------
// Whole-day ranges; booked slots inside the range stay booked (the engine only
// blocks NEW bookings), so the salon should resolve conflicts manually.

function TimeOffModal({
  employee,
  onClose,
}: {
  employee: EmployeeRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!from || !to) return setError("Tarixləri seçin.");
    if (to < from) return setError("Bitmə tarixi başlanğıcdan əvvəl ola bilməz.");
    startTransition(async () => {
      const res = await addTimeOff({
        employeeId: employee.id,
        from,
        to,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReason("");
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteTimeOff(id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-[#0d0d0f] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">
            Məzuniyyət — {employee.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Bağla" title="Bağla"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Başlanğıc</label>
              <input
                type="date"
                className={inputCls + " w-full [color-scheme:dark]"}
                value={from}
                min={today}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (to < e.target.value) setTo(e.target.value);
                }}
              />
            </div>
            <div>
              <label className={labelCls}>Son gün (daxil)</label>
              <input
                type="date"
                className={inputCls + " w-full [color-scheme:dark]"}
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Səbəb (istəyə bağlı)</label>
            <input
              className={inputCls + " w-full"}
              placeholder="məs., məzuniyyət, təlim"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
          >
            {pending ? "Əlavə edilir…" : "Əlavə et"}
          </button>
        </form>

        <div className="mt-5 border-t border-zinc-800 pt-4">
          <p className="text-xs font-medium text-zinc-500">Cari və qarşıdakı məzuniyyətlər</p>
          {employee.timeOff.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Qeyd yoxdur.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {employee.timeOff.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-zinc-900/50 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate text-zinc-200">
                    {t.label}
                    {t.reason && <span className="text-zinc-500"> · {t.reason}</span>}
                  </span>
                  <button
                    onClick={() => remove(t.id)}
                    disabled={pending}
                    className="shrink-0 text-xs text-zinc-500 transition hover:text-rose-400"
                  >
                    Sil
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-zinc-600">
            Bu günlərdə onlayn qeydiyyat üçün boş vaxt göstərilmir. Artıq təsdiqlənmiş
            görüşlər avtomatik ləğv olunmur.
          </p>
        </div>
      </div>
    </div>
  );
}
