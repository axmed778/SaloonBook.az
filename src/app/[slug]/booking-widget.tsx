"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { matchesClientGender, type Audience } from "@/lib/audience";

type Service = {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
  audience: Audience;
};
type Employee = {
  id: string;
  name: string;
  position: string | null;
  audience: Audience;
  serviceIds: string[];
};
type Day = { ymd: string; label: string };
type Slot = { startUtc: string; time: string };
type Gender = "MALE" | "FEMALE";

const azn = (m: number) => {
  const v = m / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

const optionCls = (selected: boolean) =>
  "w-full rounded-lg border px-4 py-3 text-left transition " +
  (selected
    ? "border-accent bg-accent/10"
    : "border-border bg-muted hover:border-border-strong");

export function BookingWidget({
  slug,
  salonAudience,
  services,
  employees,
  days,
}: {
  slug: string;
  salonAudience: Audience;
  services: Service[];
  employees: Employee[];
  days: Day[];
}) {
  const needGender = salonAudience === "ALL";
  const stepKeys = [
    ...(needGender ? ["gender"] : []),
    "service",
    "employee",
    "date",
    "time",
    "contact",
  ];
  const idx = (k: string) => stepKeys.indexOf(k);

  const [current, setCurrent] = useState(0);
  const [gender, setGender] = useState<Gender | null>(
    needGender ? null : (salonAudience as Gender),
  );
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    time: string;
    dayLabel: string;
    manageUrl: string | null;
  } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const selectedService = services.find((s) => s.id === serviceId) ?? null;
  const selectedEmployee = employees.find((e) => e.id === employeeId) ?? null;
  const selectedDay = days.find((d) => d.ymd === day) ?? null;

  const visibleServices = services.filter(
    (s) => gender && matchesClientGender(s.audience, gender),
  );
  const visibleEmployees = employees.filter(
    (e) =>
      serviceId &&
      e.serviceIds.includes(serviceId) &&
      gender &&
      matchesClientGender(e.audience, gender),
  );

  const activeKey = stepKeys[current];

  // Editing an earlier step resets every choice after it (handled in the pick*
  // functions below); tapping a completed summary just re-opens that step.
  function editStep(i: number) {
    setError(null);
    setCurrent(i);
  }
  function pickGender(g: Gender) {
    setGender(g);
    setServiceId(null);
    setEmployeeId(null);
    setDay(null);
    setSlot(null);
    setError(null);
    setCurrent(idx("service"));
  }
  function pickService(id: string) {
    setServiceId(id);
    setEmployeeId(null);
    setDay(null);
    setSlot(null);
    setError(null);
    setCurrent(idx("employee"));
  }
  function pickEmployee(id: string) {
    setEmployeeId(id);
    setDay(null);
    setSlot(null);
    setError(null);
    setCurrent(idx("date"));
  }
  function pickDate(d: string) {
    setDay(d);
    setSlot(null);
    setError(null);
    setCurrent(idx("time"));
  }
  function pickTime(s: Slot) {
    setSlot(s);
    setError(null);
    setCurrent(idx("contact"));
  }

  // Load slots when the time step is the active one.
  useEffect(() => {
    if (activeKey !== "time" || !serviceId || !employeeId || !day) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSlots(null);
    fetch(`/api/public/${slug}/availability?serviceId=${serviceId}&employeeId=${employeeId}&date=${day}`)
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
  }, [activeKey, serviceId, employeeId, day, slug]);

  async function submit() {
    setError(null);
    const digits = phoneDigits.replace(/\D/g, "");
    if (!name.trim()) return setError("Adınızı daxil edin.");
    if (digits.length !== 9) return setError("Telefon +994 və 9 rəqəmdən ibarət olmalıdır.");
    if (!slot || !serviceId || !employeeId) return setError("Məlumat natamamdır.");

    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/${slug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          employeeId,
          startUtc: slot.startUtc,
          name: name.trim(),
          phone: "+994" + digits,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Qeydiyyat alınmadı. Yenidən cəhd edin.");
        return;
      }
      setDone({
        time: slot.time,
        dayLabel: selectedDay?.label ?? day ?? "",
        manageUrl: typeof data.manageUrl === "string" ? data.manageUrl : null,
      });
    } catch {
      setError("Şəbəkə xətası. Yenidən cəhd edin.");
    } finally {
      setSubmitting(false);
    }
  }

  // --- Success ---
  if (done) {
    return (
      <section className="mt-8">
        <div className="rounded-xl border border-success/30 bg-success/10 p-6 text-center shadow-soft">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/20 text-success">
            <Check className="h-6 w-6" strokeWidth={2.5} />
          </span>
          <h3 className="mt-4 text-lg font-semibold text-foreground">Qeydiyyat təsdiqləndi!</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedService?.name} · {selectedEmployee?.name}
            <br />
            {done.dayLabel}, {done.time}
          </p>
          <p className="mt-4 text-xs text-faint-foreground">
            Görüşdən əvvəl sizə xatırlatma göndəriləcək.
          </p>

          {done.manageUrl && (
            <div className="mt-5 rounded-lg border border-border bg-card p-4 text-left">
              <p className="text-sm font-medium text-foreground">
                Görüşü dəyişmək və ya ləğv etmək lazım olsa:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <a
                  href={done.manageUrl}
                  className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted px-3 py-2 text-sm text-accent hover:underline"
                >
                  {done.manageUrl}
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(done.manageUrl!);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 1500);
                    } catch {
                      /* the link is visible and selectable either way */
                    }
                  }}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition hover:border-border-strong hover:text-foreground"
                >
                  {linkCopied ? "Kopyalandı ✓" : "Kopyala"}
                </button>
              </div>
              <p className="mt-2 text-xs text-faint-foreground">
                Bu linki saxlayın — görüşünüzü onlayn idarə etmək üçündür.
              </p>
            </div>
          )}
        </div>
      </section>
    );
  }

  const stepTitle: Record<string, string> = {
    gender: "Kim üçün?",
    service: "Xidmət seçin",
    employee: "Mütəxəssis seçin",
    date: "Tarix seçin",
    time: "Vaxt seçin",
    contact: "Əlaqə məlumatları",
  };

  // Compact summary text for a completed step.
  function summaryValue(key: string): string {
    switch (key) {
      case "gender":
        return gender === "MALE" ? "Kişi" : "Qadın";
      case "service":
        return selectedService
          ? `${selectedService.name} · ${azn(selectedService.priceMinor)} ₼`
          : "";
      case "employee":
        return selectedEmployee?.name ?? "";
      case "date":
        return selectedDay?.label ?? "";
      case "time":
        return slot?.time ?? "";
      default:
        return "";
    }
  }

  function Summary({ i, keyName }: { i: number; keyName: string }) {
    return (
      <button
        onClick={() => editStep(i)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-soft transition hover:border-border-strong"
      >
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{stepTitle[keyName]}</p>
          <p className="truncate font-medium text-foreground">{summaryValue(keyName)}</p>
        </div>
        <span className="shrink-0 text-xs font-medium text-accent">Dəyiş</span>
      </button>
    );
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        <span className="h-1 w-1 rounded-full bg-accent" />
        Onlayn qeydiyyat
      </div>

      <div className="space-y-2">
        {stepKeys.map((key, i) => {
          if (i > current) return null;
          if (i < current) return <Summary key={key} i={i} keyName={key} />;

          // Active step
          return (
            <div key={key} className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">{stepTitle[key]}</h3>
                <span className="text-xs text-faint-foreground">
                  {current + 1} / {stepKeys.length}
                </span>
              </div>

              {key === "gender" && (
                <div className="grid grid-cols-2 gap-3">
                  {(["MALE", "FEMALE"] as Gender[]).map((g) => (
                    <button key={g} onClick={() => pickGender(g)} className={optionCls(gender === g)}>
                      <span className="font-medium text-foreground">
                        {g === "MALE" ? "Kişi" : "Qadın"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {key === "service" && (
                <div className="space-y-2">
                  {visibleServices.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">Uyğun xidmət yoxdur.</p>
                  )}
                  {visibleServices.map((s) => (
                    <button key={s.id} onClick={() => pickService(s.id)} className={optionCls(serviceId === s.id)}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{s.name}</p>
                          <p className="text-sm text-muted-foreground">{s.durationMin} dəq</p>
                        </div>
                        <span className="shrink-0 font-medium text-foreground">{azn(s.priceMinor)} ₼</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {key === "employee" && (
                <div className="space-y-2">
                  {visibleEmployees.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Bu xidmət üçün mütəxəssis yoxdur.
                    </p>
                  )}
                  {visibleEmployees.map((e) => (
                    <button key={e.id} onClick={() => pickEmployee(e.id)} className={optionCls(employeeId === e.id)}>
                      <p className="font-medium text-foreground">{e.name}</p>
                      {e.position && <p className="text-sm text-muted-foreground">{e.position}</p>}
                    </button>
                  ))}
                </div>
              )}

              {key === "date" && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {days.map((d) => (
                    <button
                      key={d.ymd}
                      onClick={() => pickDate(d.ymd)}
                      className={
                        "rounded-lg border px-2 py-3 text-center text-sm transition " +
                        (day === d.ymd
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-border bg-muted text-muted-foreground hover:border-border-strong")
                      }
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              )}

              {key === "time" && (
                <div>
                  {slotsLoading && (
                    <p className="py-4 text-center text-sm text-muted-foreground">Yüklənir…</p>
                  )}
                  {!slotsLoading && slots && slots.length === 0 && (
                    <div className="py-4 text-center">
                      <p className="text-sm text-muted-foreground">Bu gün üçün boş vaxt yoxdur.</p>
                      <button
                        onClick={() => editStep(idx("date"))}
                        className="mt-2 text-sm font-medium text-accent hover:underline"
                      >
                        Başqa gün seçin
                      </button>
                    </div>
                  )}
                  {!slotsLoading && slots && slots.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {slots.map((s) => (
                        <button
                          key={s.startUtc}
                          onClick={() => pickTime(s)}
                          className="rounded-lg border border-border bg-muted py-2 text-center text-sm text-muted-foreground transition hover:border-accent hover:text-foreground"
                        >
                          {s.time}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {key === "contact" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-muted px-4 py-3 text-sm">
                    <p className="font-medium text-foreground">{selectedService?.name}</p>
                    <p className="text-muted-foreground">
                      {selectedEmployee?.name} · {selectedDay?.label} · {slot?.time} ·{" "}
                      {selectedService ? azn(selectedService.priceMinor) : ""} ₼
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Adınız</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ad Soyad"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefon</label>
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">+994</span>
                      <input
                        value={phoneDigits}
                        onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
                        inputMode="numeric"
                        placeholder="501234567"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>

                  {error && <p className="text-sm text-rose-500">{error}</p>}

                  <button
                    onClick={submit}
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground shadow-sm shadow-accent/20 transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {submitting ? "Təsdiqlənir…" : "Qeydiyyatı təsdiqlə"}
                    {!submitting && <ChevronRight className="h-4 w-4" strokeWidth={2} />}
                  </button>
                </div>
              )}

              {key !== "contact" && error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
