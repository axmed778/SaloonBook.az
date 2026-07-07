"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CalendarClock, XCircle } from "lucide-react";

type Slot = { startUtc: string; time: string };
type Day = { ymd: string; label: string };
type Status = "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

const azn = (minor: number) => {
  const v = minor / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

export function ManageWidget({
  token,
  salonName,
  salonSlug,
  customerName,
  service,
  durationMin,
  employee,
  whenLabel,
  priceMinor,
  status,
  upcoming,
  days,
}: {
  token: string;
  salonName: string;
  salonSlug: string;
  customerName: string;
  service: string;
  durationMin: number;
  employee: string;
  whenLabel: string;
  priceMinor: number;
  status: Status;
  upcoming: boolean;
  days: Day[];
}) {
  const router = useRouter();
  const canModify = status === "CONFIRMED" && upcoming;

  const [mode, setMode] = useState<"view" | "reschedule" | "confirm-cancel">("view");
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "reschedule" || !day) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setSlots(null);
    setSlot(null);
    fetch(`/api/public/manage/${token}?date=${day}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSlots(Array.isArray(data.slots) ? data.slots : []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, day, token]);

  async function post(body: object): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/manage/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Əməliyyat alınmadı. Yenidən cəhd edin.");
        return false;
      }
      return true;
    } catch {
      setError("Şəbəkə xətası. Yenidən cəhd edin.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function cancelAppointment() {
    if (await post({ action: "cancel" })) {
      setNotice("Görüş ləğv edildi.");
      setMode("view");
      router.refresh();
    }
  }

  async function reschedule() {
    if (!slot) return;
    if (await post({ action: "reschedule", startUtc: slot.startUtc })) {
      setNotice("Görüşün vaxtı dəyişdirildi. Yeni təsdiq mesajı göndəriləcək.");
      setMode("view");
      router.refresh();
    }
  }

  const statusBanner =
    status === "CANCELLED" ? (
      <Banner tone="muted" icon={<XCircle className="h-5 w-5" />}>
        Bu görüş ləğv edilib.
      </Banner>
    ) : status === "COMPLETED" ? (
      <Banner tone="success" icon={<Check className="h-5 w-5" />}>
        Bu görüş tamamlanıb. Təşəkkürlər!
      </Banner>
    ) : status === "NO_SHOW" ? (
      <Banner tone="muted" icon={<XCircle className="h-5 w-5" />}>
        Bu görüş baş tutmayıb.
      </Banner>
    ) : !upcoming ? (
      <Banner tone="muted" icon={<CalendarClock className="h-5 w-5" />}>
        Bu görüşün vaxtı keçib.
      </Banner>
    ) : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Görüş idarəetməsi</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {salonName}
        </h1>
      </div>

      {notice && (
        <Banner tone="success" icon={<Check className="h-5 w-5" />}>
          {notice}
        </Banner>
      )}
      {statusBanner}

      {/* Appointment details */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
        <dl className="space-y-2.5 text-sm">
          <Row label="Müştəri" value={customerName} />
          <Row label="Xidmət" value={`${service} · ${durationMin} dəq`} />
          <Row label="Mütəxəssis" value={employee} />
          <Row label="Tarix" value={whenLabel} />
          <Row label="Qiymət" value={`${azn(priceMinor)} ₼`} />
        </dl>
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Actions */}
      {canModify && mode === "view" && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setMode("reschedule");
              setDay(days[0]?.ymd ?? null);
              setNotice(null);
            }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Vaxtı dəyiş
          </button>
          <button
            onClick={() => {
              setMode("confirm-cancel");
              setNotice(null);
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:border-danger/50 hover:text-danger"
          >
            Görüşü ləğv et
          </button>
        </div>
      )}

      {/* Cancel confirmation */}
      {canModify && mode === "confirm-cancel" && (
        <section className="rounded-xl border border-danger/30 bg-danger/5 p-5">
          <p className="text-sm font-medium text-foreground">Görüşü ləğv etmək istəyirsiniz?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Salon məlumatlandırılacaq. Yenidən yer ayırmaq üçün salonun səhifəsindən istifadə
            edə bilərsiniz.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={cancelAppointment}
              disabled={busy}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Ləğv edilir…" : "Bəli, ləğv et"}
            </button>
            <button
              onClick={() => setMode("view")}
              disabled={busy}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Geri
            </button>
          </div>
        </section>
      )}

      {/* Reschedule */}
      {canModify && mode === "reschedule" && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Yeni vaxt seçin</h2>
            <button
              onClick={() => setMode("view")}
              className="text-sm text-muted-foreground transition hover:text-foreground"
            >
              Bağla
            </button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {days.map((d) => (
              <button
                key={d.ymd}
                onClick={() => setDay(d.ymd)}
                className={
                  "shrink-0 rounded-lg border px-3 py-1.5 text-sm transition " +
                  (day === d.ymd
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground")
                }
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {slotsLoading ? (
              <p className="text-sm text-muted-foreground">Yüklənir…</p>
            ) : slots && slots.length > 0 ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {slots.map((s) => (
                  <button
                    key={s.startUtc}
                    onClick={() => setSlot(s)}
                    className={
                      "rounded-lg border px-2 py-1.5 text-sm transition " +
                      (slot?.startUtc === s.startUtc
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-foreground hover:border-border-strong")
                    }
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            ) : slots ? (
              <p className="text-sm text-muted-foreground">Bu gün üçün boş vaxt yoxdur.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Tarix seçin.</p>
            )}
          </div>

          <button
            onClick={reschedule}
            disabled={!slot || busy}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Dəyişdirilir…" : slot ? `Yeni vaxtı təsdiqlə — ${slot.time}` : "Vaxt seçin"}
          </button>
        </section>
      )}

      <p className="text-center text-sm text-muted-foreground">
        <a href={`/${salonSlug}`} className="text-accent hover:underline">
          {salonName} səhifəsinə keç
        </a>
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "success" | "muted";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === "success"
      ? "border-success/30 bg-success/10 text-success"
      : "border-border bg-card text-muted-foreground";
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border p-4 text-sm ${cls}`}>
      {icon}
      <span className="text-foreground">{children}</span>
    </div>
  );
}
