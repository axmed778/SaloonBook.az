"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createAddon, updateAddon, setAddonActive, deleteAddon } from "./actions";
import { ConfirmDialog } from "../_components/confirm-dialog";
import { ErrorToast } from "../_components/toast";
import { parseAznAmount } from "@/lib/money";

// Add-ons ("Əlavə xidmətlər"): optional extras — French +5 ₼, Nail art +3 ₼ — a
// customer adds to a main service while booking. The owner links each one to
// the services it goes with; the booking flow adds its price and minutes.

export type AddonRow = {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
  isActive: boolean;
  serviceIds: string[];
};

type ServiceOption = { id: string; name: string; isActive: boolean };

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

const aznLabel = (minor: number) => {
  const v = minor / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

const emptyForm = { name: "", price: "", duration: "0", serviceIds: [] as string[] };

export function AddonsManager({
  addons,
  services,
}: {
  addons: AddonRow[];
  services: ServiceOption[];
}) {
  const t = useTranslations("Services");
  const tc = useTranslations("Common");
  const router = useRouter();
  const fid = useId();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<AddonRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  function startAdd() {
    setEditingId(null);
    // One service in the salon: it is the only possible answer, so pre-tick it.
    setForm({ ...emptyForm, serviceIds: services.length === 1 ? [services[0].id] : [] });
    setError(null);
    setOpen(true);
  }

  function startEdit(a: AddonRow) {
    setEditingId(a.id);
    setForm({
      name: a.name,
      price: aznLabel(a.priceMinor),
      duration: String(a.durationMin),
      serviceIds: a.serviceIds,
    });
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setEditingId(null);
    setError(null);
  }

  function toggleService(id: string) {
    setForm((f) => ({
      ...f,
      serviceIds: f.serviceIds.includes(id)
        ? f.serviceIds.filter((x) => x !== id)
        : [...f.serviceIds, id],
    }));
  }

  function submit() {
    const payload = {
      name: form.name.trim(),
      priceAzn: parseAznAmount(form.price),
      durationMin: parseInt(form.duration || "0", 10),
      serviceIds: form.serviceIds,
    };
    if (!payload.name) return setError(t("errors.nameRequired"));
    if (payload.priceAzn === null) return setError(t("errors.priceInvalid"));
    if (!Number.isFinite(payload.durationMin) || payload.durationMin < 0)
      return setError(t("errors.durationInvalid"));
    if (payload.serviceIds.length === 0) return setError(t("addons.errors.servicesRequired"));

    startTransition(async () => {
      const res = editingId ? await updateAddon(editingId, payload) : await createAddon(payload);
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function toggleActive(a: AddonRow) {
    startTransition(async () => {
      await setAddonActive(a.id, !a.isActive);
      router.refresh();
    });
  }

  function remove(a: AddonRow) {
    startTransition(async () => {
      const res = await deleteAddon(a.id);
      if (!res.ok) setToast(res.error);
      setConfirmRemove(null);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby={`${fid}-title`}>
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={`${fid}-title`} className="text-lg font-semibold text-foreground">
            {t("addons.title")}
          </h2>
          <p className="mt-0.5 max-w-xl text-sm text-faint-foreground">{t("addons.subtitle")}</p>
        </div>
        {!open && services.length > 0 && (
          <button
            onClick={startAdd}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            {t("addons.new")}
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {open && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">
            {editingId ? t("addons.edit") : t("addons.new")}
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor={`${fid}-name`}>
                {t("name")}
              </label>
              <input
                id={`${fid}-name`}
                className={inputCls}
                placeholder={t("addons.namePlaceholder")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className={labelCls} htmlFor={`${fid}-price`}>
                {t("addons.price")}
              </label>
              <input
                id={`${fid}-price`}
                className={inputCls}
                inputMode="decimal"
                placeholder="5"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor={`${fid}-duration`}>
                {t("addons.duration")}
              </label>
              <input
                id={`${fid}-duration`}
                className={inputCls}
                inputMode="numeric"
                placeholder="0"
                value={form.duration}
                aria-describedby={`${fid}-duration-hint`}
                onChange={(e) =>
                  setForm({ ...form, duration: e.target.value.replace(/\D/g, "").slice(0, 4) })
                }
              />
              <p id={`${fid}-duration-hint`} className="mt-1 text-xs text-faint-foreground">
                {t("addons.durationHint")}
              </p>
            </div>
          </div>

          <div className="mt-4" role="group" aria-labelledby={`${fid}-services`}>
            <span id={`${fid}-services`} className={labelCls}>
              {t("addons.services")}
            </span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {services.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-hover"
                >
                  <input
                    type="checkbox"
                    checked={form.serviceIds.includes(s.id)}
                    onChange={() => toggleService(s.id)}
                    className="h-4 w-4 shrink-0 accent-rose-600"
                  />
                  <span className="min-w-0 truncate">{s.name}</span>
                  {!s.isActive && (
                    <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {t("inactive")}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
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
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-faint-foreground">
          {t("addons.noServices")}
        </p>
      ) : addons.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-secondary-foreground">{t("addons.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-faint-foreground">
            {t("addons.emptyBody")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {addons.map((a) => {
            const linked = a.serviceIds
              .map((id) => serviceName.get(id))
              .filter((n): n is string => Boolean(n));
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-foreground">{a.name}</p>
                    {!a.isActive && (
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t("inactive")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-faint-foreground">
                    {a.durationMin > 0
                      ? t("addons.extraTime", { min: a.durationMin })
                      : t("addons.noExtraTime")}
                  </p>
                  <p
                    className={
                      "mt-0.5 truncate text-xs " +
                      (linked.length > 0 ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")
                    }
                  >
                    {linked.length > 0
                      ? t("addons.linkedTo", { names: linked.join(", ") })
                      : t("addons.notLinked")}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <span className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground">
                    +{aznLabel(a.priceMinor)} ₼
                  </span>
                  <button
                    onClick={() => startEdit(a)}
                    disabled={pending}
                    className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                  >
                    {t("editAction")}
                  </button>
                  <button
                    onClick={() => toggleActive(a)}
                    disabled={pending}
                    className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                  >
                    {a.isActive ? t("deactivate") : t("activate")}
                  </button>
                  <button
                    onClick={() => setConfirmRemove(a)}
                    disabled={pending}
                    className="text-sm text-rose-700 dark:text-rose-400/80 transition hover:text-rose-400 disabled:opacity-60"
                  >
                    {t("delete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t("addons.deleteTitle")}
          body={t.rich("addons.deleteConfirm", {
            name: confirmRemove.name,
            b: (chunks) => <span className="font-medium text-secondary-foreground">{chunks}</span>,
          })}
          pending={pending}
          onConfirm={() => remove(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}
      {toast && <ErrorToast message={toast} onClose={() => setToast(null)} />}
    </section>
  );
}
