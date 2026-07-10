"use client";

// Replacement for native confirm(): same modal chrome as the rest of the
// dashboard. Render conditionally — `{state && <ConfirmDialog …/>}` — with the
// caller holding what's being confirmed in its own state.
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Bəli, sil",
  pending = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0d0d0f] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        <div className="mt-2 text-sm text-zinc-400">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500"
          >
            Ləğv et
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-60"
          >
            {pending ? "Gözləyin…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
