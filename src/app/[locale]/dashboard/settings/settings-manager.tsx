"use client";

import { useRef, useState, useTransition } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  WEEKDAYS_ORDER,
  minToHHMM,
  hhmmToMin,
  type BusinessHour,
} from "@/lib/business-hours";
import {
  updateProfile,
  updateSlug,
  updateBusinessHours,
  createBranch,
  updateBranch,
  setBranchStatus,
  deleteBranch,
} from "./actions";
import { TimeSelect } from "../_components/time-select";
import { ConfirmDialog } from "../_components/confirm-dialog";
import { Link } from "@/i18n/navigation";
import { MapPin, Store } from "lucide-react";

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";
const cardCls = "rounded-xl border border-border bg-card p-5";
const saveBtn =
  "rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60";

type SalonData = {
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  slug: string;
  businessHours: BusinessHour[];
};

export type BranchRow = {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
  /** Oldest branch — carries the public booking link, can't be deactivated. */
  isPrimary: boolean;
  /** The branch the dashboard is currently switched to. */
  isCurrent: boolean;
};

type BranchSection = {
  branches: BranchRow[];
  /** Whether the effective plan allows creating more branches (Pro). */
  multiBranch: boolean;
  /** Total branch allowance: plan base (Pro = 3) + paid extra slots. */
  maxBranches: number;
};

type DayState = { on: boolean; open: string; close: string };
type HoursState = Record<number, DayState>;

function buildHours(existing: BusinessHour[]): HoursState {
  const state: HoursState = {};
  for (const weekday of WEEKDAYS_ORDER) {
    const found = existing.find((h) => h.weekday === weekday);
    state[weekday] = found
      ? { on: true, open: minToHHMM(found.openMin), close: minToHHMM(found.closeMin) }
      : { on: false, open: "10:00", close: "19:00" };
  }
  return state;
}

const TIME_RE = /^\d{2}:\d{2}$/;

export function SettingsManager({
  salon,
  appUrl,
  branchSection = null,
}: {
  salon: SalonData;
  appUrl: string;
  branchSection?: BranchSection | null;
}) {
  const t = useTranslations("Settings");
  const router = useRouter();

  const multiActive = (branchSection?.branches.filter((b) => b.active).length ?? 0) > 1;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-faint-foreground">{t("subtitle")}</p>
      </div>

      {/* Two columns on wide screens so the page fills the width instead of
          leaving a tall empty gutter: salon config on the left, the shareable
          booking link + QR on the right. Collapses to one column below lg. */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
          <ProfileCard salon={salon} onSaved={() => router.refresh()} />
          <HoursCard businessHours={salon.businessHours} onSaved={() => router.refresh()} />
        </div>
        <div className="space-y-6">
          <LinkCard
            slug={salon.slug}
            appUrl={appUrl}
            shared={multiActive}
            onSaved={() => router.refresh()}
          />
          {branchSection && (
            <BranchesCard section={branchSection} onSaved={() => router.refresh()} />
          )}
        </div>
      </div>
    </div>
  );
}

// --- Profile ---------------------------------------------------------------

function ProfileCard({ salon, onSaved }: { salon: SalonData; onSaved: () => void }) {
  const t = useTranslations("Settings");
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    name: salon.name,
    description: salon.description ?? "",
    address: salon.address ?? "",
    phone: salon.phone ?? "",
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateProfile({
        name: form.name.trim(),
        description: form.description.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
      });
      if (res.ok) {
        setMsg({ ok: true, text: t("saved") });
        onSaved();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <section className={cardCls}>
      <h2 className="text-sm font-semibold text-foreground">{t("profile.title")}</h2>
      <div className="mt-4 space-y-4">
        <div>
          <label className={labelCls}>{t("profile.name")}</label>
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>{t("profile.description")}</label>
          <textarea
            className={inputCls + " min-h-[72px] resize-y"}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t("profile.descriptionPlaceholder")}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{t("profile.address")}</label>
            <input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>{t("profile.phone")}</label>
            <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+994..." />
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={pending} className={saveBtn}>
          {pending ? t("saving") : t("save")}
        </button>
        {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{msg.text}</span>}
      </div>
    </section>
  );
}

// --- Booking link ----------------------------------------------------------

function LinkCard({
  slug,
  appUrl,
  shared = false,
  onSaved,
}: {
  slug: string;
  appUrl: string;
  /** True when 2+ active branches share this one link (Pro multi-branch). */
  shared?: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(slug);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullUrl = `${appUrl.replace(/\/$/, "")}/${slug}`;

  function copy() {
    navigator.clipboard?.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await updateSlug({ slug: value });
      if (res.ok) {
        setEditing(false);
        onSaved();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <section className={cardCls}>
      <h2 className="text-sm font-semibold text-foreground">{t("link.title")}</h2>
      <p className="mt-1 text-sm text-faint-foreground">{t("link.subtitle")}</p>
      {shared && (
        <p className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          {t("link.sharedNote")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-sm text-secondary-foreground">
          {fullUrl}
        </code>
        <button
          onClick={copy}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
        >
          {copied ? t("link.copied") : t("link.copy")}
        </button>
        <a
          href={`/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
        >
          {t("link.open")}
        </a>
      </div>

      {editing ? (
        <div className="mt-4">
          <label className={labelCls}>{t("link.newLinkLabel")}</label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-faint-foreground">{appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}/</span>
            <input
              className={inputCls + " max-w-xs"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="mysalon"
            />
          </div>
          {error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button onClick={save} disabled={pending} className={saveBtn}>
              {pending ? t("saving") : t("save")}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setValue(slug);
                setError(null);
              }}
              disabled={pending}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
            >
              {tc("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="mt-3 text-sm text-muted-foreground transition hover:text-foreground"
        >
          {t("link.change")}
        </button>
      )}

      <BookingQr url={fullUrl} slug={slug} />
    </section>
  );
}

// QR code for the public booking link. Salons print it (counter, window, flyer)
// so walk-in customers book by scanning. Must be dark-on-light to scan, so it
// sits on a white card. A hidden high-res canvas backs the PNG download for print.
function BookingQr({ url, slug }: { url: string; slug: string }) {
  const t = useTranslations("Settings");
  const hiResRef = useRef<HTMLDivElement>(null);

  function download() {
    const canvas = hiResRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `salonbook-qr-${slug}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-border pt-4">
      <div className="rounded-xl bg-white p-3">
        <QRCodeCanvas value={url} size={140} marginSize={2} level="M" />
      </div>
      {/* High-res copy (offscreen) used only for the PNG download. */}
      <div ref={hiResRef} className="hidden" aria-hidden>
        <QRCodeCanvas value={url} size={1024} marginSize={4} level="M" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-secondary-foreground">{t("link.qrTitle")}</p>
        <p className="mt-1 max-w-xs text-sm text-faint-foreground">{t("link.qrHint")}</p>
        <button
          onClick={download}
          className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
        >
          {t("link.qrDownload")}
        </button>
      </div>
    </div>
  );
}

// --- Branches (filiallar) ---------------------------------------------------

// Pro-only multi-branch management: create branches (any name the owner wants,
// plus an address shown to clients in the booking-page branch dropdown), rename
// them, and switch them on/off. All branches share ONE public booking link.
function BranchesCard({ section, onSaved }: { section: BranchSection; onSaved: () => void }) {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BranchRow | null>(null);
  const [form, setForm] = useState({ name: "", address: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function reset() {
    setAdding(false);
    setEditingId(null);
    setForm({ name: "", address: "" });
  }

  function submitCreate() {
    setMsg(null);
    start(async () => {
      const res = await createBranch({
        name: form.name.trim(),
        address: form.address.trim() || null,
      });
      if (res.ok) {
        reset();
        setMsg({ ok: true, text: t("saved") });
        onSaved();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  function submitEdit(id: string) {
    setMsg(null);
    start(async () => {
      const res = await updateBranch({
        id,
        name: form.name.trim(),
        address: form.address.trim() || null,
      });
      if (res.ok) {
        reset();
        setMsg({ ok: true, text: t("saved") });
        onSaved();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  function toggleActive(id: string, active: boolean) {
    setMsg(null);
    start(async () => {
      const res = await setBranchStatus({ id, active });
      if (res.ok) {
        setMsg({ ok: true, text: t("saved") });
        onSaved();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  function remove(b: BranchRow) {
    setMsg(null);
    start(async () => {
      const res = await deleteBranch({ id: b.id });
      setConfirmDelete(null);
      if (res.ok) {
        setMsg({ ok: true, text: t("saved") });
        onSaved();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  const branchForm = (submit: () => void) => (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
      <div>
        <label className={labelCls}>{t("branches.name")}</label>
        <input
          className={inputCls}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder={t("branches.namePlaceholder")}
        />
      </div>
      <div>
        <label className={labelCls}>{t("branches.address")}</label>
        <input
          className={inputCls}
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          placeholder={t("branches.addressPlaceholder")}
        />
      </div>
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={pending || form.name.trim().length < 2} className={saveBtn}>
          {pending ? t("saving") : t("save")}
        </button>
        <button
          onClick={reset}
          disabled={pending}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
        >
          {tc("cancel")}
        </button>
      </div>
    </div>
  );

  const atLimit = section.branches.length >= section.maxBranches;

  return (
    <section className={cardCls}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Store className="h-4 w-4 text-rose-700 dark:text-rose-400" strokeWidth={2} />
            {t("branches.title")}
            {section.multiBranch && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                {t("branches.usage", {
                  count: section.branches.length,
                  max: section.maxBranches,
                })}
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-faint-foreground">{t("branches.subtitle")}</p>
        </div>
        {section.multiBranch && !atLimit && !adding && editingId === null && (
          <button
            onClick={() => {
              setAdding(true);
              setForm({ name: "", address: "" });
              setMsg(null);
            }}
            className={saveBtn + " shrink-0"}
          >
            {t("branches.add")}
          </button>
        )}
      </div>

      {/* Allowance used up: extra slots are sold manually (15 ₼ each), so point
          the owner at support instead of a button that can only error. */}
      {section.multiBranch && atLimit && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {t("branches.limitHint")}
        </p>
      )}

      {!section.multiBranch && (
        <div className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/5 p-4">
          <p className="text-sm font-medium text-foreground">{t("branches.proTeaserTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("branches.proTeaserBody")}</p>
          <Link
            href="/dashboard/billing"
            className="mt-3 inline-block rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            {t("branches.proTeaserCta")}
          </Link>
        </div>
      )}

      <div className="mt-4 divide-y divide-border/60">
        {section.branches.map((b) => (
          <div key={b.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={"h-2 w-2 shrink-0 rounded-full " + (b.isCurrent ? "bg-rose-500" : "bg-border")} />
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{b.name}</span>
              {b.isPrimary && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  {t("branches.primaryBadge")}
                </span>
              )}
              {b.isCurrent && (
                <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                  {t("branches.currentBadge")}
                </span>
              )}
              {!b.active && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  {t("branches.suspendedBadge")}
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-2 text-sm">
                {section.multiBranch && (
                  <button
                    onClick={() => {
                      setEditingId(b.id);
                      setAdding(false);
                      setForm({ name: b.name, address: b.address ?? "" });
                      setMsg(null);
                    }}
                    disabled={pending}
                    className="text-muted-foreground transition hover:text-foreground"
                  >
                    {t("branches.edit")}
                  </button>
                )}
                {section.multiBranch && !b.isPrimary && (
                  <button
                    onClick={() => toggleActive(b.id, !b.active)}
                    disabled={pending}
                    className={
                      b.active
                        ? "text-muted-foreground transition hover:text-rose-700 dark:hover:text-rose-400"
                        : "text-emerald-700 transition hover:text-emerald-600 dark:text-emerald-400"
                    }
                  >
                    {b.active ? t("branches.deactivate") : t("branches.activate")}
                  </button>
                )}
                {/* Hard delete: any plan (post-downgrade cleanup), never the
                    primary. The action itself refuses when history exists. */}
                {!b.isPrimary && (
                  <button
                    onClick={() => setConfirmDelete(b)}
                    disabled={pending}
                    className="text-rose-700 transition hover:text-rose-600 dark:text-rose-400"
                  >
                    {t("branches.delete")}
                  </button>
                )}
              </span>
            </div>
            <p className="ml-4 mt-1 flex items-center gap-1 text-xs text-faint-foreground">
              <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
              {b.address || t("branches.noAddress")}
            </p>
            {editingId === b.id && branchForm(() => submitEdit(b.id))}
          </div>
        ))}
      </div>

      {adding && branchForm(submitCreate)}

      {section.multiBranch && section.branches.filter((b) => b.active).length > 1 && (
        <p className="mt-3 text-xs text-faint-foreground">{t("branches.linkNote")}</p>
      )}
      {msg && (
        <p className={"mt-3 text-sm " + (msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
          {msg.text}
        </p>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("branches.deleteTitle")}
          body={t.rich("branches.deleteConfirm", {
            name: confirmDelete.name,
            b: (chunks) => <span className="font-medium text-secondary-foreground">{chunks}</span>,
          })}
          pending={pending}
          onConfirm={() => remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}

// --- Business hours --------------------------------------------------------

function HoursCard({ businessHours, onSaved }: { businessHours: BusinessHour[]; onSaved: () => void }) {
  const t = useTranslations("Settings");
  const tWeekday = useTranslations("Weekdays");
  const [pending, start] = useTransition();
  const [hours, setHours] = useState<HoursState>(buildHours(businessHours));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function setDay(weekday: number, patch: Partial<DayState>) {
    setHours((cur) => ({ ...cur, [weekday]: { ...cur[weekday], ...patch } }));
  }

  function save() {
    setMsg(null);
    const payload: BusinessHour[] = [];
    for (const weekday of WEEKDAYS_ORDER) {
      const d = hours[weekday];
      if (!d.on) continue;
      if (!TIME_RE.test(d.open) || !TIME_RE.test(d.close)) {
        return setMsg({ ok: false, text: t("hours.fillHours", { day: tWeekday(String(weekday)) }) });
      }
      const openMin = hhmmToMin(d.open);
      const closeMin = hhmmToMin(d.close);
      if (!Number.isFinite(openMin) || !Number.isFinite(closeMin) || closeMin <= openMin) {
        return setMsg({ ok: false, text: t("hours.closeAfterOpen", { day: tWeekday(String(weekday)) }) });
      }
      payload.push({ weekday, openMin, closeMin });
    }
    start(async () => {
      const res = await updateBusinessHours(payload);
      if (res.ok) {
        setMsg({ ok: true, text: t("saved") });
        onSaved();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <section className={cardCls}>
      <h2 className="text-sm font-semibold text-foreground">{t("hours.title")}</h2>
      <p className="mt-1 text-sm text-faint-foreground">{t("hours.subtitle")}</p>

      <div className="mt-4 divide-y divide-border/60">
        {WEEKDAYS_ORDER.map((weekday) => {
          const d = hours[weekday];
          return (
            <div key={weekday} className="flex flex-wrap items-center gap-3 py-2.5">
              <label className="flex w-40 cursor-pointer items-center gap-2.5 text-sm font-medium text-secondary-foreground">
                <input
                  type="checkbox"
                  checked={d.on}
                  onChange={(e) => setDay(weekday, { on: e.target.checked })}
                  className="h-4 w-4 rounded accent-rose-500"
                />
                {tWeekday(String(weekday))}
              </label>
              {d.on ? (
                <div className="flex items-center gap-2">
                  <TimeSelect value={d.open} onChange={(v) => setDay(weekday, { open: v })} />
                  <span className="text-faint-foreground">—</span>
                  <TimeSelect value={d.close} onChange={(v) => setDay(weekday, { close: v })} />
                </div>
              ) : (
                <span className="text-sm text-faint-foreground">{t("hours.closed")}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={pending} className={saveBtn}>
          {pending ? t("saving") : t("save")}
        </button>
        {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{msg.text}</span>}
      </div>
    </section>
  );
}
