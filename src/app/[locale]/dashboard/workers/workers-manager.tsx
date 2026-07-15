"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  saveEmployee,
  setEmployeeActive,
  deleteEmployee,
  addTimeOff,
  deleteTimeOff,
} from "./actions";
import { type Audience } from "@/lib/audience";
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
// Displayed Monday-first, as is conventional in Azerbaijan. Labels come from
// the Weekdays message namespace.
const WEEKDAYS: number[] = [1, 2, 3, 4, 5, 6, 0];

const inputCls =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

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
  for (const weekday of WEEKDAYS) {
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
  for (const weekday of WEEKDAYS) {
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
  const t = useTranslations("Workers");
  const tc = useTranslations("Common");
  const tWeekday = useTranslations("Weekdays");
  const tAudience = useTranslations("Audience");
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
    if (!form.name.trim()) return setError(t("errors.nameRequired"));

    const TIME_RE = /^\d{2}:\d{2}$/;
    const hoursPayload: HourRow[] = [];
    for (const weekday of WEEKDAYS) {
      const d = hours[weekday];
      if (!d.on) continue;
      // A cleared <input type="time"> reports "" — reject it (and any partial
      // value) explicitly, otherwise toMin() yields NaN and slips past the
      // comparison below.
      if (!TIME_RE.test(d.start) || !TIME_RE.test(d.end)) {
        return setError(t("errors.fillHours", { day: tWeekday(String(weekday)) }));
      }
      const startMin = toMin(d.start);
      const endMin = toMin(d.end);
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        return setError(t("errors.endAfterStart", { day: tWeekday(String(weekday)) }));
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
          <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-faint-foreground">
            {t("subtitle")}
          </p>
        </div>
        {!open && (
          <button
            onClick={startAdd}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            {t("new")}
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {open && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            {form.id ? t("edit") : t("new")}
          </h2>

          {/* Basic fields */}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className={labelCls}>{t("name")}</label>
              <input
                className={inputCls + " w-full"}
                placeholder={t("namePlaceholder")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className={labelCls}>{t("position")}</label>
              <input
                className={inputCls + " w-full"}
                placeholder={t("positionPlaceholder")}
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>{t("phone")}</label>
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
              label={t("worksWith")}
            />
          </div>

          {/* Services */}
          <div className="mt-5">
            <label className={labelCls}>{t("services")}</label>
            {activeServices.length === 0 ? (
              <p className="text-sm text-faint-foreground">
                {t("noServices")}
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
                          ? "border-rose-500/50 bg-rose-500/15 text-rose-800 dark:text-rose-200"
                          : "border-border text-muted-foreground hover:bg-hover")
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
            <label className={labelCls}>{t("schedule")}</label>
            <div className="space-y-2">
              {WEEKDAYS.map((weekday) => {
                const d = hours[weekday];
                return (
                  <div key={weekday} className="flex flex-wrap items-center gap-3">
                    <label className="flex w-40 items-center gap-2 text-sm text-secondary-foreground">
                      <input
                        type="checkbox"
                        checked={d.on}
                        onChange={(e) => setDay(weekday, { on: e.target.checked })}
                        className="h-4 w-4 accent-rose-500"
                      />
                      {tWeekday(String(weekday))}
                    </label>
                    {d.on ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          step={900}
                          value={d.start}
                          onChange={(e) => setDay(weekday, { start: e.target.value })}
                          className={inputCls + ""}
                        />
                        <span className="text-faint-foreground">—</span>
                        <input
                          type="time"
                          step={900}
                          value={d.end}
                          onChange={(e) => setDay(weekday, { end: e.target.value })}
                          className={inputCls + ""}
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-faint-foreground">{t("dayOff")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active toggle */}
          <label className="mt-5 flex items-center gap-2 text-sm text-secondary-foreground">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 accent-rose-500"
            />
            {t("activeLabel")}
          </label>

          {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
            >
              {pending ? t("saving") : t("save")}
            </button>
            <button
              onClick={close}
              disabled={pending}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover disabled:opacity-60"
            >
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {employees.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border text-center">
          <p className="text-sm font-medium text-secondary-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 max-w-xs text-sm text-faint-foreground">
            {t("emptyBody")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {employees.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                  {e.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-foreground">{e.name}</p>
                    <span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {tAudience(e.audience)}
                    </span>
                    {!e.isActive && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t("inactive")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-faint-foreground">
                    {e.position || "—"}
                    <span className="text-faint-foreground"> · </span>
                    {t("servicesCount", { count: e.serviceIds.length })}
                    <span className="text-faint-foreground"> · </span>
                    {t("workDaysCount", { count: e.hours.length })}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <button
                  onClick={() => setTimeOffFor(e)}
                  disabled={pending}
                  className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                >
                  {t("timeOff")}
                  {e.timeOff.length > 0 && (
                    <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {e.timeOff.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => startEdit(e)}
                  disabled={pending}
                  className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                >
                  {t("editAction")}
                </button>
                <button
                  onClick={() => toggleActive(e)}
                  disabled={pending}
                  className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                >
                  {e.isActive ? t("deactivate") : t("activate")}
                </button>
                <button
                  onClick={() => setConfirmRemove(e)}
                  disabled={pending}
                  className="text-sm text-rose-700 dark:text-rose-400/80 transition hover:text-rose-400 disabled:opacity-60"
                >
                  {t("delete")}
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
          title={t("deleteTitle")}
          body={t.rich("deleteConfirm", {
            name: confirmRemove.name,
            b: (chunks) => <span className="font-medium text-secondary-foreground">{chunks}</span>,
          })}
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
  const t = useTranslations("Workers");
  const tc = useTranslations("Common");
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
    if (!from || !to) return setError(t("timeOffModal.errors.selectDates"));
    if (to < from) return setError(t("timeOffModal.errors.endBeforeStart"));
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
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {t("timeOffModal.titleFor", { name: employee.name })}
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

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t("timeOffModal.start")}</label>
              <input
                type="date"
                className={inputCls + " w-full"}
                value={from}
                min={today}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (to < e.target.value) setTo(e.target.value);
                }}
              />
            </div>
            <div>
              <label className={labelCls}>{t("timeOffModal.endInclusive")}</label>
              <input
                type="date"
                className={inputCls + " w-full"}
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>{t("timeOffModal.reason")}</label>
            <input
              className={inputCls + " w-full"}
              placeholder={t("timeOffModal.reasonPlaceholder")}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
          >
            {pending ? t("timeOffModal.adding") : t("timeOffModal.add")}
          </button>
        </form>

        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs font-medium text-faint-foreground">{t("timeOffModal.current")}</p>
          {employee.timeOff.length === 0 ? (
            <p className="mt-2 text-sm text-faint-foreground">{t("timeOffModal.none")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {employee.timeOff.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate text-secondary-foreground">
                    {row.label}
                    {row.reason && <span className="text-faint-foreground"> · {row.reason}</span>}
                  </span>
                  <button
                    onClick={() => remove(row.id)}
                    disabled={pending}
                    className="shrink-0 text-xs text-faint-foreground transition hover:text-rose-400"
                  >
                    {t("delete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-faint-foreground">
            {t("timeOffModal.note")}
          </p>
        </div>
      </div>
    </div>
  );
}
