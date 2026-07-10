"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { azn, inputCls, labelCls } from "@/app/[locale]/dashboard/_components/calendar-shared";
import { ErrorToast } from "@/app/[locale]/dashboard/_components/toast";
import { BookingModal } from "@/app/[locale]/dashboard/_components/booking-modal";
import type { CatalogEmployee } from "@/app/[locale]/dashboard/_components/calendar-shared";
import { setAppointmentStatus } from "@/app/[locale]/dashboard/actions";
import {
  updateCustomer,
  addCustomerNote,
  deleteCustomerNote,
  deleteCustomer,
} from "../actions";

export type AppointmentItem = {
  id: string;
  whenLabel: string;
  service: string;
  employee: string;
  priceMinor: number;
  status: "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  source: "PUBLIC" | "DASHBOARD";
  createdLabel: string;
};

export type NoteItem = { id: string; body: string; createdLabel: string };

export type ProfileData = {
  id: string;
  name: string;
  phone: string;
  createdLabel: string;
  active: boolean;
  stats: {
    visits: number;
    spentMinor: number;
    avgTicketMinor: number;
    completed: number;
    cancelled: number;
    noShow: number;
    upcoming: number;
    firstVisitLabel: string | null;
    lastVisitLabel: string | null;
    favEmployee: string | null;
    favService: string | null;
    frequencyDays: number | null;
    lastActivityLabel: string | null;
  };
  totalAppointments: number;
  historyTruncated: boolean;
  branchName: string;
};

const STATUS_LABEL: Record<AppointmentItem["status"], string> = {
  CONFIRMED: "Təsdiqlənib",
  COMPLETED: "Tamamlanıb",
  CANCELLED: "Ləğv edilib",
  NO_SHOW: "Gəlmədi",
};

const STATUS_CHIP: Record<AppointmentItem["status"], string> = {
  CONFIRMED: "bg-rose-500/10 text-rose-300",
  COMPLETED: "bg-emerald-500/10 text-emerald-400",
  CANCELLED: "bg-zinc-800 text-zinc-500",
  NO_SHOW: "bg-amber-500/10 text-amber-400",
};

function StatusPill({ status }: { status: AppointmentItem["status"] }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("az-AZ"))
    .join("");
}

export function ClientProfile({
  data,
  upcoming,
  past,
  notes,
  catalog,
  today,
}: {
  data: ProfileData;
  upcoming: AppointmentItem[];
  past: AppointmentItem[];
  notes: NoteItem[];
  catalog: CatalogEmployee[];
  today: string;
}) {
  const router = useRouter();
  const s = data.stats;
  const [booking, setBooking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detail, setDetail] = useState<AppointmentItem | null>(null);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function copyPhone() {
    try {
      await navigator.clipboard.writeText(data.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setToast(`Kopyalama alınmadı — nömrə: ${data.phone}`);
    }
  }

  const actionBtn =
    "inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100";

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <Link
        href="/dashboard/clients"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 transition hover:text-zinc-200"
      >
        ← Müştərilər
      </Link>

      {/* Header + quick actions */}
      <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-sm font-semibold text-rose-300">
              {initials(data.name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-zinc-100">{data.name}</h1>
                {data.active ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Aktiv
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                    Passiv
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-zinc-400">{data.phone}</p>
              <p className="mt-0.5 text-xs text-zinc-600">
                Qeydiyyat: {data.createdLabel}
                {s.lastActivityLabel ? ` · son aktivlik: ${s.lastActivityLabel}` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setBooking(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-400"
            >
              + Yeni görüş
            </button>
            <a href={`tel:${data.phone}`} className={actionBtn}>
              Zəng et
            </a>
            <button onClick={copyPhone} className={actionBtn}>
              {copied ? "Kopyalandı ✓" : "Nömrəni kopyala"}
            </button>
            <button onClick={() => setEditing(true)} className={actionBtn}>
              Redaktə et
            </button>
            <button
              onClick={() => setDeleting(true)}
              className="inline-flex items-center rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-medium text-rose-400 transition hover:border-rose-500/60 hover:bg-rose-500/10"
            >
              Sil
            </button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Vizitlər" value={String(s.visits)} />
        <Stat label="Ümumi xərclədiyi (LTV)" value={`${azn(s.spentMinor)} ₼`} highlight />
        <Stat label="Orta çek" value={s.visits > 0 ? `${azn(s.avgTicketMinor)} ₼` : "—"} />
        <Stat
          label="Vizit tezliyi"
          value={s.frequencyDays !== null ? `~${s.frequencyDays} gündə bir` : "—"}
        />
        <Stat label="Tamamlanmış" value={String(s.completed)} />
        <Stat label="Ləğv edilmiş" value={String(s.cancelled)} tone={s.cancelled > 0 ? "muted" : undefined} />
        <Stat label="Gəlmədi" value={String(s.noShow)} tone={s.noShow > 0 ? "warn" : undefined} />
        <Stat label="Qarşıdakı görüşlər" value={String(s.upcoming)} />
      </section>

      {/* Derived analytics */}
      <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
        <h2 className="text-sm font-medium text-zinc-300">Müştəri haqqında</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <InfoRow label="Sevimli usta" value={s.favEmployee ?? "—"} />
          <InfoRow label="Sevimli xidmət" value={s.favService ?? "—"} />
          <InfoRow label="İlk vizit" value={s.firstVisitLabel ?? "—"} />
          <InfoRow label="Son vizit" value={s.lastVisitLabel ?? "—"} />
        </dl>
      </section>

      {/* Notes */}
      <NotesSection customerId={data.id} notes={notes} />

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
          <h2 className="text-sm font-medium text-zinc-300">Qarşıdakı görüşlər</h2>
          <AppointmentList items={upcoming} onSelect={setDetail} />
        </section>
      )}

      {/* History */}
      <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
        <h2 className="text-sm font-medium text-zinc-300">
          Görüş tarixçəsi
          <span className="ml-2 text-xs font-normal text-zinc-500">
            {data.totalAppointments} görüş
          </span>
        </h2>
        {past.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Keçmiş görüş yoxdur.</p>
        ) : (
          <>
            <AppointmentList items={past} onSelect={setDetail} />
            {data.historyTruncated && (
              <p className="mt-3 text-xs text-zinc-600">
                Son {past.length + upcoming.length} görüş göstərilir.
              </p>
            )}
          </>
        )}
      </section>

      {/* Modals */}
      {booking && (
        <BookingModal
          catalog={catalog}
          defaultDay={today}
          today={today}
          initialName={data.name}
          initialPhoneDigits={data.phone.replace(/^\+994/, "")}
          onClose={() => setBooking(false)}
        />
      )}
      {editing && (
        <EditCustomerModal
          id={data.id}
          name={data.name}
          phone={data.phone}
          onClose={() => setEditing(false)}
        />
      )}
      {deleting && (
        <DeleteCustomerModal
          id={data.id}
          name={data.name}
          totalAppointments={data.totalAppointments}
          onDone={() => router.push("/dashboard/clients")}
          onClose={() => setDeleting(false)}
        />
      )}
      {detail && (
        <AppointmentDetailModal
          item={detail}
          branchName={data.branchName}
          onClose={() => setDetail(null)}
        />
      )}
      {toast && <ErrorToast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// --- Small presentational pieces ---------------------------------------------

function Stat({
  label,
  value,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "warn" | "muted";
}) {
  const valueCls = highlight
    ? "text-rose-400"
    : tone === "warn"
      ? "text-amber-300"
      : tone === "muted"
        ? "text-zinc-400"
        : "text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold ${valueCls}`}>{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/50 pb-2 sm:border-0 sm:pb-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate text-right text-zinc-200">{value}</dd>
    </div>
  );
}

function AppointmentList({
  items,
  onSelect,
}: {
  items: AppointmentItem[];
  onSelect: (a: AppointmentItem) => void;
}) {
  return (
    <ul className="mt-3 divide-y divide-zinc-800/60">
      {items.map((a) => (
        <li key={a.id}>
          <button
            onClick={() => onSelect(a)}
            className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:bg-zinc-900/50"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-200">
                {a.service}
                <span className="text-zinc-500"> · {a.employee}</span>
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">{a.whenLabel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-medium text-zinc-200">{azn(a.priceMinor)} ₼</span>
              <StatusPill status={a.status} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- Notes ---------------------------------------------------------------------

function NotesSection({ customerId, notes }: { customerId: string; notes: NoteItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) return;
    startTransition(async () => {
      const res = await addCustomerNote({ customerId, body: body.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteCustomerNote(id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
      <h2 className="text-sm font-medium text-zinc-300">
        Qeydlər
        <span className="ml-2 text-xs font-normal text-zinc-600">yalnız sizə görünür</span>
      </h2>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          placeholder="məs., VIP müştəri · adətən gecikir · Nigarı üstün tutur"
          className={inputCls + " w-full"}
        />
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="shrink-0 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
        >
          Əlavə et
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}

      {notes.length > 0 && (
        <ul className="mt-4 space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group flex items-start justify-between gap-3 rounded-lg bg-zinc-900/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">{n.body}</p>
                <p className="mt-0.5 text-xs text-zinc-600">{n.createdLabel}</p>
              </div>
              <button
                onClick={() => remove(n.id)}
                disabled={pending}
                aria-label="Qeydi sil"
                className="shrink-0 text-xs text-zinc-600 transition hover:text-rose-400"
              >
                Sil
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Modals ----------------------------------------------------------------------

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-[#0d0d0f] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function EditCustomerModal({
  id,
  name: initialName,
  phone: initialPhone,
  onClose,
}: {
  id: string;
  name: string;
  phone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [phoneDigits, setPhoneDigits] = useState(initialPhone.replace(/^\+994/, ""));
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const digits = phoneDigits.replace(/\D/g, "");
    if (!name.trim()) return setError("Ad tələb olunur.");
    if (digits.length !== 9) return setError("Telefon +994 və 9 rəqəmdən ibarət olmalıdır.");
    startTransition(async () => {
      const res = await updateCustomer({ id, name: name.trim(), phone: "+994" + digits });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <ModalShell title="Müştərini redaktə et" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>Ad</label>
          <input className={inputCls + " w-full"} value={name} onChange={(e) => setName(e.target.value)} />
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
            />
          </div>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500"
          >
            Ləğv et
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
          >
            {pending ? "Gözləyin…" : "Yadda saxla"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function DeleteCustomerModal({
  id,
  name,
  totalAppointments,
  onDone,
  onClose,
}: {
  id: string;
  name: string;
  totalAppointments: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    startTransition(async () => {
      const res = await deleteCustomer(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <ModalShell title="Müştərini sil" onClose={onClose}>
      <p className="text-sm text-zinc-300">
        <span className="font-medium text-zinc-100">{name}</span> silinsin?
      </p>
      <p className="mt-2 text-sm text-rose-300">
        {totalAppointments > 0
          ? `Bununla birlikdə ${totalAppointments} görüş qeydi və bütün qeydlər həmişəlik silinəcək. Bu görüşlər analitikadan da çıxacaq.`
          : "Müştəri və bütün qeydləri həmişəlik silinəcək."}
      </p>
      <p className="mt-1 text-xs text-zinc-500">Bu əməliyyat geri qaytarıla bilməz.</p>
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500"
        >
          Ləğv et
        </button>
        <button
          onClick={confirm}
          disabled={pending}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-60"
        >
          {pending ? "Silinir…" : "Bəli, sil"}
        </button>
      </div>
    </ModalShell>
  );
}

function AppointmentDetailModal({
  item,
  branchName,
  onClose,
}: {
  item: AppointmentItem;
  branchName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function changeStatus(status: "COMPLETED" | "NO_SHOW" | "CANCELLED") {
    startTransition(async () => {
      const res = await setAppointmentStatus({ id: item.id, status });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <ModalShell title="Görüş detalları" onClose={onClose}>
      <dl className="space-y-2 text-sm">
        <DetailRow label="Xidmət" value={item.service} />
        <DetailRow label="Usta" value={item.employee} />
        <DetailRow label="Tarix" value={item.whenLabel} />
        <DetailRow label="Qiymət" value={`${azn(item.priceMinor)} ₼`} />
        <DetailRow
          label="Status"
          value={<StatusPill status={item.status} />}
        />
        <DetailRow
          label="Mənbə"
          value={item.source === "PUBLIC" ? "Onlayn qeydiyyat" : "Salon tərəfindən"}
        />
        <DetailRow label="Filial" value={branchName} />
        <DetailRow label="Yaradılıb" value={item.createdLabel} />
      </dl>

      {item.status === "CONFIRMED" && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <p className="mb-2 text-xs text-zinc-500">Statusu dəyiş:</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => changeStatus("COMPLETED")}
              disabled={pending}
              className="rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-600/30 disabled:opacity-50"
            >
              Tamamla
            </button>
            <button
              onClick={() => changeStatus("NO_SHOW")}
              disabled={pending}
              className="rounded-lg bg-amber-600/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-600/30 disabled:opacity-50"
            >
              Gəlmədi
            </button>
            <button
              onClick={() => changeStatus("CANCELLED")}
              disabled={pending}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-50"
            >
              Ləğv et
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
    </ModalShell>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-200">{value}</dd>
    </div>
  );
}
