"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEmployee, setEmployeeActive, deleteEmployee } from "./actions";
import { AUDIENCE_LABEL, type Audience } from "@/lib/audience";
import { AudienceSelect } from "../_components/audience-select";

type Svc = { id: string; name: string; isActive: boolean };
type HourRow = { weekday: number; startMin: number; endMin: number };
export type EmployeeRow = {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
  isActive: boolean;
  audience: Audience;
  serviceIds: string[];
  hours: HourRow[];
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
      await setEmployeeActive(e.id, !e.isActive);
      router.refresh();
    });
  }

  function remove(e: EmployeeRow) {
    if (!confirm(`"${e.name}" işçisini silmək istəyirsiniz?`)) return;
    startTransition(async () => {
      const res = await deleteEmployee(e.id);
      if (!res.ok) alert(res.error);
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
                  onClick={() => remove(e)}
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
    </div>
  );
}
