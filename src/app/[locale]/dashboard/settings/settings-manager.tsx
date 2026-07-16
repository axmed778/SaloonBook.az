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
import { updateProfile, updateSlug, updateBusinessHours } from "./actions";

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

// 24-hour "HH:MM" options in 15-minute steps (Azerbaijan uses 24h; the native
// <input type="time"> picker forced 12h AM/PM and looked dated).
const TIME_OPTIONS: string[] = Array.from({ length: (24 * 60) / 15 }, (_, i) =>
  minToHHMM(i * 15),
);

const timeSelectCls =
  "rounded-lg border border-border bg-background px-2.5 py-2 text-sm tabular-nums text-foreground focus:border-rose-500 focus:outline-none";

// Styled 24h time dropdown. Keeps an off-grid saved value selectable by folding
// it into the option list rather than showing a blank.
function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [value, ...TIME_OPTIONS];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={timeSelectCls}>
      {options.map((tm) => (
        <option key={tm} value={tm}>
          {tm}
        </option>
      ))}
    </select>
  );
}

export function SettingsManager({
  salon,
  appUrl,
}: {
  salon: SalonData;
  appUrl: string;
}) {
  const t = useTranslations("Settings");
  const router = useRouter();

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
          <LinkCard slug={salon.slug} appUrl={appUrl} onSaved={() => router.refresh()} />
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

function LinkCard({ slug, appUrl, onSaved }: { slug: string; appUrl: string; onSaved: () => void }) {
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
