"use client";

import { useState, useTransition } from "react";
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
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";
const cardCls = "rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5";
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
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">{t("subtitle")}</p>
      </div>

      <ProfileCard salon={salon} onSaved={() => router.refresh()} />
      <LinkCard slug={salon.slug} appUrl={appUrl} onSaved={() => router.refresh()} />
      <HoursCard businessHours={salon.businessHours} onSaved={() => router.refresh()} />
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
      <h2 className="text-sm font-semibold text-zinc-100">{t("profile.title")}</h2>
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
        {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-400" : "text-rose-400")}>{msg.text}</span>}
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
      <h2 className="text-sm font-semibold text-zinc-100">{t("link.title")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("link.subtitle")}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
          {fullUrl}
        </code>
        <button
          onClick={copy}
          className="rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800/60"
        >
          {copied ? t("link.copied") : t("link.copy")}
        </button>
        <a
          href={`/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800/60"
        >
          {t("link.open")}
        </a>
      </div>

      {editing ? (
        <div className="mt-4">
          <label className={labelCls}>{t("link.newLinkLabel")}</label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-500">{appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}/</span>
            <input
              className={inputCls + " max-w-xs"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="mysalon"
            />
          </div>
          {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
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
              className="rounded-lg border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800/60"
            >
              {tc("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="mt-3 text-sm text-zinc-400 transition hover:text-zinc-100"
        >
          {t("link.change")}
        </button>
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
      <h2 className="text-sm font-semibold text-zinc-100">{t("hours.title")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("hours.subtitle")}</p>

      <div className="mt-4 space-y-2">
        {WEEKDAYS_ORDER.map((weekday) => {
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
                {tWeekday(String(weekday))}
              </label>
              {d.on ? (
                <div className="flex items-center gap-2">
                  <input type="time" step={900} value={d.open} onChange={(e) => setDay(weekday, { open: e.target.value })} className={inputCls + " w-auto [color-scheme:dark]"} />
                  <span className="text-zinc-600">—</span>
                  <input type="time" step={900} value={d.close} onChange={(e) => setDay(weekday, { close: e.target.value })} className={inputCls + " w-auto [color-scheme:dark]"} />
                </div>
              ) : (
                <span className="text-sm text-zinc-600">{t("hours.closed")}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={pending} className={saveBtn}>
          {pending ? "Saxlanılır…" : "Saxla"}
        </button>
        {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-400" : "text-rose-400")}>{msg.text}</span>}
      </div>
    </section>
  );
}
