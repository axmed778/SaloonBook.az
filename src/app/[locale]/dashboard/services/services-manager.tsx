"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  createService,
  updateService,
  setServiceActive,
  deleteService,
} from "./actions";
import { type Audience } from "@/lib/audience";
import { AudienceSelect } from "../_components/audience-select";
import { ConfirmDialog } from "../_components/confirm-dialog";
import { ErrorToast } from "../_components/toast";

export type ServiceRow = {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
  bufferMin: number;
  isActive: boolean;
  audience: Audience;
};

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

const aznLabel = (minor: number) => {
  const v = minor / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

const emptyForm = {
  name: "",
  price: "",
  duration: "45",
  buffer: "10",
  audience: "ALL" as Audience,
};

export function ServicesManager({ services }: { services: ServiceRow[] }) {
  const t = useTranslations("Services");
  const tc = useTranslations("Common");
  const tAudience = useTranslations("Audience");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ServiceRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function startAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function startEdit(s: ServiceRow) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      price: aznLabel(s.priceMinor),
      duration: String(s.durationMin),
      buffer: String(s.bufferMin),
      audience: s.audience,
    });
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setEditingId(null);
    setError(null);
  }

  function submit() {
    const payload = {
      name: form.name.trim(),
      priceAzn: parseFloat(form.price),
      durationMin: parseInt(form.duration, 10),
      bufferMin: parseInt(form.buffer || "0", 10),
      audience: form.audience,
    };
    if (!payload.name) return setError(t("errors.nameRequired"));
    if (!Number.isFinite(payload.priceAzn) || payload.priceAzn < 0)
      return setError(t("errors.priceInvalid"));
    if (!Number.isFinite(payload.durationMin) || payload.durationMin <= 0)
      return setError(t("errors.durationInvalid"));
    if (!Number.isFinite(payload.bufferMin) || payload.bufferMin < 0) payload.bufferMin = 0;

    startTransition(async () => {
      const res = editingId
        ? await updateService(editingId, payload)
        : await createService(payload);
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function toggleActive(s: ServiceRow) {
    startTransition(async () => {
      await setServiceActive(s.id, !s.isActive);
      router.refresh();
    });
  }

  function remove(s: ServiceRow) {
    startTransition(async () => {
      const res = await deleteService(s.id);
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
            {editingId ? t("edit") : t("new")}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>{t("name")}</label>
              <input
                className={inputCls}
                placeholder={t("namePlaceholder")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className={labelCls}>{t("price")}</label>
              <input
                className={inputCls}
                inputMode="decimal"
                placeholder="20"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t("duration")}</label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="45"
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>{t("buffer")}</label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="10"
                  value={form.buffer}
                  onChange={(e) => setForm({ ...form, buffer: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <AudienceSelect
              value={form.audience}
              onChange={(a) => setForm({ ...form, audience: a })}
            />
          </div>

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
      {services.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border text-center">
          <p className="text-sm font-medium text-secondary-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 max-w-xs text-sm text-faint-foreground">
            {t("emptyBody")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {services.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-foreground">{s.name}</p>
                  <span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {tAudience(s.audience)}
                  </span>
                  {!s.isActive && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {t("inactive")}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-faint-foreground">
                  {t("minutesShort", { min: s.durationMin })}
                  {s.bufferMin > 0 && <span className="text-faint-foreground"> {t("bufferSuffix", { min: s.bufferMin })}</span>}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground">
                  {aznLabel(s.priceMinor)} ₼
                </span>
                <button
                  onClick={() => startEdit(s)}
                  disabled={pending}
                  className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                >
                  {t("editAction")}
                </button>
                <button
                  onClick={() => toggleActive(s)}
                  disabled={pending}
                  className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                >
                  {s.isActive ? t("deactivate") : t("activate")}
                </button>
                <button
                  onClick={() => setConfirmRemove(s)}
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
