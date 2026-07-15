"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
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

const STATUS_CHIP: Record<AppointmentItem["status"], string> = {
  CONFIRMED: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  COMPLETED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "bg-secondary text-faint-foreground",
  NO_SHOW: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

function StatusPill({ status }: { status: AppointmentItem["status"] }) {
  const t = useTranslations("ClientProfile.status");
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[status]}`}
    >
      {t(status)}
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
  const t = useTranslations("ClientProfile");
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
      setToast(t("copyFailed", { phone: data.phone }));
    }
  }

  const actionBtn =
    "inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-secondary-foreground transition hover:border-border-strong hover:text-foreground";

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <Link
        href="/dashboard/clients"
        className="inline-flex items-center gap-1 text-sm text-faint-foreground transition hover:text-foreground"
      >
        ← {t("back")}
      </Link>

      {/* Header + quick actions */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-sm font-semibold text-rose-700 dark:text-rose-300">
              {initials(data.name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-foreground">{data.name}</h1>
                {data.active ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {t("statusActive")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-faint-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
                    {t("statusInactive")}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{data.phone}</p>
              <p className="mt-0.5 text-xs text-faint-foreground">
                {t("registered")}: {data.createdLabel}
                {s.lastActivityLabel ? t("lastActivityInline", { date: s.lastActivityLabel }) : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setBooking(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-400"
            >
              + {t("newBooking")}
            </button>
            <a href={`tel:${data.phone}`} className={actionBtn}>
              {t("call")}
            </a>
            <button onClick={copyPhone} className={actionBtn}>
              {copied ? t("copied") : t("copyPhone")}
            </button>
            <button onClick={() => setEditing(true)} className={actionBtn}>
              {t("edit")}
            </button>
            <button
              onClick={() => setDeleting(true)}
              className="inline-flex items-center rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 transition hover:border-rose-500/60 hover:bg-rose-500/10"
            >
              {t("delete")}
            </button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("stats.visits")} value={String(s.visits)} />
        <Stat label={t("stats.ltv")} value={`${azn(s.spentMinor)} ₼`} highlight />
        <Stat label={t("stats.avgTicket")} value={s.visits > 0 ? `${azn(s.avgTicketMinor)} ₼` : "—"} />
        <Stat
          label={t("stats.frequency")}
          value={s.frequencyDays !== null ? t("stats.frequencyValue", { days: s.frequencyDays }) : "—"}
        />
        <Stat label={t("stats.completed")} value={String(s.completed)} />
        <Stat label={t("stats.cancelled")} value={String(s.cancelled)} tone={s.cancelled > 0 ? "muted" : undefined} />
        <Stat label={t("stats.noShow")} value={String(s.noShow)} tone={s.noShow > 0 ? "warn" : undefined} />
        <Stat label={t("stats.upcoming")} value={String(s.upcoming)} />
      </section>

      {/* Derived analytics */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium text-secondary-foreground">{t("about")}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <InfoRow label={t("favEmployee")} value={s.favEmployee ?? "—"} />
          <InfoRow label={t("favService")} value={s.favService ?? "—"} />
          <InfoRow label={t("firstVisit")} value={s.firstVisitLabel ?? "—"} />
          <InfoRow label={t("lastVisit")} value={s.lastVisitLabel ?? "—"} />
        </dl>
      </section>

      {/* Notes */}
      <NotesSection customerId={data.id} notes={notes} />

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-medium text-secondary-foreground">{t("upcomingTitle")}</h2>
          <AppointmentList items={upcoming} onSelect={setDetail} />
        </section>
      )}

      {/* History */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium text-secondary-foreground">
          {t("historyTitle")}
          <span className="ml-2 text-xs font-normal text-faint-foreground">
            {t("appointmentsCount", { count: data.totalAppointments })}
          </span>
        </h2>
        {past.length === 0 ? (
          <p className="mt-3 text-sm text-faint-foreground">{t("noPast")}</p>
        ) : (
          <>
            <AppointmentList items={past} onSelect={setDetail} />
            {data.historyTruncated && (
              <p className="mt-3 text-xs text-faint-foreground">
                {t("showingLast", { count: past.length + upcoming.length })}
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
    ? "text-rose-700 dark:text-rose-400"
    : tone === "warn"
      ? "text-amber-700 dark:text-amber-300"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-faint-foreground">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold ${valueCls}`}>{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2 sm:border-0 sm:pb-0">
      <dt className="text-faint-foreground">{label}</dt>
      <dd className="truncate text-right text-secondary-foreground">{value}</dd>
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
    <ul className="mt-3 divide-y divide-border">
      {items.map((a) => (
        <li key={a.id}>
          <button
            onClick={() => onSelect(a)}
            className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:bg-hover"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-secondary-foreground">
                {a.service}
                <span className="text-faint-foreground"> · {a.employee}</span>
              </p>
              <p className="mt-0.5 text-xs text-faint-foreground">{a.whenLabel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-medium text-secondary-foreground">{azn(a.priceMinor)} ₼</span>
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
  const t = useTranslations("ClientProfile.notes");
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
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-medium text-secondary-foreground">
        {t("title")}
        <span className="ml-2 text-xs font-normal text-faint-foreground">{t("privateHint")}</span>
      </h2>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          placeholder={t("placeholder")}
          className={inputCls + " w-full"}
        />
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="shrink-0 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover disabled:opacity-50"
        >
          {t("add")}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

      {notes.length > 0 && (
        <ul className="mt-4 space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group flex items-start justify-between gap-3 rounded-lg bg-muted px-3 py-2"
            >
              <div className="min-w-0">
                <p className="whitespace-pre-wrap break-words text-sm text-secondary-foreground">{n.body}</p>
                <p className="mt-0.5 text-xs text-faint-foreground">{n.createdLabel}</p>
              </div>
              <button
                onClick={() => remove(n.id)}
                disabled={pending}
                aria-label={t("deleteAria")}
                className="shrink-0 text-xs text-faint-foreground transition hover:text-rose-400"
              >
                {t("delete")}
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
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
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
  const t = useTranslations("ClientProfile.edit_modal");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [phoneDigits, setPhoneDigits] = useState(initialPhone.replace(/^\+994/, ""));
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const digits = phoneDigits.replace(/\D/g, "");
    if (!name.trim()) return setError(t("errNameRequired"));
    if (digits.length !== 9) return setError(t("errPhone"));
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
    <ModalShell title={t("title")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>{t("name")}</label>
          <input className={inputCls + " w-full"} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{t("phone")}</label>
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
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
        {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-secondary-foreground transition hover:border-border-strong"
          >
            {tc("cancel")}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
          >
            {pending ? tc("pleaseWait") : t("save")}
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
  const t = useTranslations("ClientProfile.delete_modal");
  const tc = useTranslations("Common");
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
    <ModalShell title={t("title")} onClose={onClose}>
      <p className="text-sm text-secondary-foreground">
        {t.rich("confirmWith", {
          name,
          b: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
        })}
      </p>
      <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">
        {totalAppointments > 0
          ? t("bodyWithHistory", { count: totalAppointments })
          : t("bodyNoHistory")}
      </p>
      <p className="mt-1 text-xs text-faint-foreground">{t("irreversible")}</p>
      {error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-sm text-secondary-foreground transition hover:border-border-strong"
        >
          {tc("cancel")}
        </button>
        <button
          onClick={confirm}
          disabled={pending}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-60"
        >
          {pending ? t("deleting") : tc("confirmDelete")}
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
  const t = useTranslations("ClientProfile.detail");
  const tc = useTranslations("Common");
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
    <ModalShell title={t("title")} onClose={onClose}>
      <dl className="space-y-2 text-sm">
        <DetailRow label={t("service")} value={item.service} />
        <DetailRow label={t("employee")} value={item.employee} />
        <DetailRow label={t("date")} value={item.whenLabel} />
        <DetailRow label={t("price")} value={`${azn(item.priceMinor)} ₼`} />
        <DetailRow
          label={t("status")}
          value={<StatusPill status={item.status} />}
        />
        <DetailRow
          label={t("source")}
          value={item.source === "PUBLIC" ? t("sourcePublic") : t("sourceDashboard")}
        />
        <DetailRow label={t("branch")} value={branchName} />
        <DetailRow label={t("createdAt")} value={item.createdLabel} />
      </dl>

      {item.status === "CONFIRMED" && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs text-faint-foreground">{t("changeStatus")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => changeStatus("COMPLETED")}
              disabled={pending}
              className="rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 transition hover:bg-emerald-600/30 disabled:opacity-50"
            >
              {t("complete")}
            </button>
            <button
              onClick={() => changeStatus("NO_SHOW")}
              disabled={pending}
              className="rounded-lg bg-amber-600/20 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 transition hover:bg-amber-600/30 disabled:opacity-50"
            >
              {t("noShow")}
            </button>
            <button
              onClick={() => changeStatus("CANCELLED")}
              disabled={pending}
              className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition hover:bg-hover disabled:opacity-50"
            >
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
    </ModalShell>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-faint-foreground">{label}</dt>
      <dd className="text-right text-secondary-foreground">{value}</dd>
    </div>
  );
}
