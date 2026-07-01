"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createService,
  updateService,
  setServiceActive,
  deleteService,
} from "./actions";

export type ServiceRow = {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
  bufferMin: number;
  isActive: boolean;
};

const inputCls =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

const aznLabel = (minor: number) => {
  const v = minor / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

const emptyForm = { name: "", price: "", duration: "45", buffer: "10" };

export function ServicesManager({ services }: { services: ServiceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

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
    };
    if (!payload.name) return setError("Ad tələb olunur.");
    if (!Number.isFinite(payload.priceAzn) || payload.priceAzn < 0)
      return setError("Qiymət düzgün deyil.");
    if (!Number.isFinite(payload.durationMin) || payload.durationMin <= 0)
      return setError("Müddət düzgün deyil.");
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
    if (!confirm(`"${s.name}" xidmətini silmək istəyirsiniz?`)) return;
    startTransition(async () => {
      const res = await deleteService(s.id);
      if (!res.ok) alert(res.error);
      router.refresh();
    });
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Xidmətlər</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Salonunuzun xidmətləri, qiymət və müddət.
          </p>
        </div>
        {!open && (
          <button
            onClick={startAdd}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            Yeni xidmət
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {open && (
        <div className="mb-6 rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
          <h2 className="text-sm font-semibold text-zinc-100">
            {editingId ? "Xidməti redaktə et" : "Yeni xidmət"}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Ad</label>
              <input
                className={inputCls}
                placeholder="Saç kəsimi"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className={labelCls}>Qiymət (₼)</label>
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
                <label className={labelCls}>Müddət (dəq)</label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="45"
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>Buffer (dəq)</label>
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
      {services.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 text-center">
          <p className="text-sm font-medium text-zinc-300">Hələ xidmət yoxdur</p>
          <p className="mt-1 max-w-xs text-sm text-zinc-500">
            «Yeni xidmət» düyməsi ilə ilk xidmətinizi əlavə edin.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {services.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-[#0d0d0f] px-4 py-3.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-zinc-100">{s.name}</p>
                  {!s.isActive && (
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                      Deaktiv
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {s.durationMin} dəq
                  {s.bufferMin > 0 && <span className="text-zinc-600"> +{s.bufferMin} buffer</span>}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-100">
                  {aznLabel(s.priceMinor)} ₼
                </span>
                <button
                  onClick={() => startEdit(s)}
                  disabled={pending}
                  className="text-sm text-zinc-400 transition hover:text-zinc-100 disabled:opacity-60"
                >
                  Redaktə
                </button>
                <button
                  onClick={() => toggleActive(s)}
                  disabled={pending}
                  className="text-sm text-zinc-400 transition hover:text-zinc-100 disabled:opacity-60"
                >
                  {s.isActive ? "Deaktiv et" : "Aktiv et"}
                </button>
                <button
                  onClick={() => remove(s)}
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
