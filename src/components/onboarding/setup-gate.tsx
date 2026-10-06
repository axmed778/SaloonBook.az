"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useModalA11y } from "@/components/use-modal-a11y";
import { TimeSelect } from "@/app/[locale]/dashboard/_components/time-select";
import { WEEKDAYS_ORDER, hhmmToMin } from "@/lib/business-hours";
import type { GateStepId } from "@/lib/onboarding/gate";
import type { SetupGateData } from "@/lib/onboarding/load";
import {
  finishSetup,
  saveSetupHours,
  saveSetupMaster,
  saveSetupProfile,
  saveSetupService,
} from "@/app/[locale]/dashboard/_actions/setup";

// The mandatory setup walk-through: the five things a salon needs before it can
// be booked online, one screen at a time, each explained in a sentence and
// filled in right here. No menu to find, no screen to learn, nothing to search
// for — the next thing to do is the only thing on screen.
//
// Deliberately not dismissable (same posture as the legal ConsentGate): no
// close button, no backdrop dismiss, no Escape. Until the salon can take a
// booking, the dashboard behind it has nothing to show. The one way out that is
// not "finish" is signing out, so nobody is trapped in someone else's browser.
//
// Which step is on screen is the SERVER's answer (src/lib/onboarding/gate.ts),
// read from the salon's own rows: each save refreshes the route, the layout
// recomputes, and the gate either moves on or disappears. So a reload lands on
// the same step, two tabs agree, and a step cannot be skipped by a client that
// says it is done.

type Result = { ok: true } | { ok: false; error: string };

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

/** Minutes a service may take, as the options a small salon actually picks. */
const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];

export function SetupGate({
  gate,
  logoutPath,
  logoutHref,
}: {
  gate: SetupGateData;
  /** POST endpoint that clears the session cookie. */
  logoutPath: string;
  /** Where to land after signing out. */
  logoutHref: string;
}) {
  const t = useTranslations("Onboarding.gate");
  const tShort = useTranslations("Onboarding.gate.weekdayShort");
  const router = useRouter();
  // `null` close handler: the gate is non-dismissable, so the hook only
  // contributes the dialog role, its name and the focus trap.
  const { titleId, dialogProps } = useModalA11y(null);

  // Tagged with the step it is about, so moving on simply stops showing it —
  // no effect watching the step, which would fire a render late and flash a
  // message from the step before.
  const [failure, setFailure] = useState<{ step: GateStepId; message: string } | null>(null);
  const [pending, start] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const busy = pending || leaving;

  // Step 1
  const [phone, setPhone] = useState(gate.phone ?? "");
  const [address, setAddress] = useState(gate.address ?? "");
  // Step 2
  const [serviceName, setServiceName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("30");
  // Step 3
  const [masterName, setMasterName] = useState("");
  // Step 4 — Monday to Saturday, the week a salon in Baku usually works.
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [opensAt, setOpensAt] = useState("10:00");
  const [closesAt, setClosesAt] = useState("19:00");
  // Step 5
  const [copied, setCopied] = useState(false);

  // The page behind still scrolls on touch and stays reachable by keyboard
  // without this, which would make the block a picture of one.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const error = failure?.step === gate.current ? failure.message : null;
  const fail = (message: string) => setFailure({ step: gate.current, message });

  function submit(run: () => Promise<Result>) {
    setFailure(null);
    start(async () => {
      try {
        const res = await run();
        if (!res.ok) {
          fail(res.error);
          return;
        }
        // The server decides what comes next: re-render the layout, which
        // re-reads the salon and either shows the next step or takes the gate
        // away.
        router.refresh();
      } catch {
        fail(t("failed"));
      }
    });
  }

  function onLogout() {
    setLeaving(true);
    void (async () => {
      try {
        await fetch(logoutPath, { method: "POST" });
        router.push(logoutHref);
        router.refresh();
      } finally {
        setLeaving(false);
      }
    })();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(gate.bookingUrl);
      setCopied(true);
    } catch {
      // No clipboard permission (or an insecure origin): the link is on screen
      // and selectable, so the step is still doable by hand.
      setCopied(true);
    }
  }

  const stepNo = gate.steps.findIndex((s) => s.id === gate.current) + 1;
  const pct = Math.round(((stepNo - 1) / gate.total) * 100);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        {...dialogProps}
        // Which step is on screen, for the e2e walk-through: the dialog's own
        // name is the step's title, which is copy and may be reworded.
        data-setup-step={gate.current}
        className="relative w-full max-w-lg rounded-t-2xl border border-border bg-card p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-2xl focus:outline-none sm:rounded-2xl sm:pb-6"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("progress", { step: stepNo, total: gate.total })}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-emerald-600 transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>

        <h2 id={titleId} className="mt-4 text-xl font-semibold text-foreground">
          {t(`steps.${gate.current}.title`)}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t(`steps.${gate.current}.why`)}
        </p>

        {/* Said once, on the first step: the trial is already running, on the
            tier the owner's own answer at registration picked. */}
        {stepNo === 1 && gate.signupStaffCount !== null && gate.planKey && (
          <p className="mt-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-xs leading-relaxed text-secondary-foreground">
            {t("trial", {
              count: gate.signupStaffCount,
              plan: t(`plans.${gate.planKey}`),
            })}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-3">
          {gate.current === "profile" && (
            <>
              <div>
                <label className={labelCls} htmlFor="setup-phone">
                  {t("fields.phone")}
                </label>
                <input
                  id="setup-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+994 50 123 45 67"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="setup-address">
                  {t("fields.address")}
                </label>
                <input
                  id="setup-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={inputCls}
                />
              </div>
            </>
          )}

          {gate.current === "service" && (
            <>
              <div>
                <label className={labelCls} htmlFor="setup-service">
                  {t("fields.serviceName")}
                </label>
                <input
                  id="setup-service"
                  type="text"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelCls} htmlFor="setup-price">
                    {t("fields.price")}
                  </label>
                  <input
                    id="setup-price"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.5"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="flex-1">
                  <label className={labelCls} htmlFor="setup-duration">
                    {t("fields.duration")}
                  </label>
                  <select
                    id="setup-duration"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className={inputCls}
                  >
                    {DURATIONS.map((m) => (
                      <option key={m} value={m}>
                        {t("fields.minutes", { count: m })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {gate.current === "master" && (
            <div>
              <label className={labelCls} htmlFor="setup-master">
                {t("fields.masterName")}
              </label>
              <input
                id="setup-master"
                type="text"
                value={masterName}
                onChange={(e) => setMasterName(e.target.value)}
                className={inputCls}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {gate.signupStaffCount && gate.signupStaffCount > 1
                  ? t("fields.masterRest", { count: gate.signupStaffCount - 1 })
                  : t("fields.masterSelf")}
              </p>
            </div>
          )}

          {gate.current === "hours" && (
            <>
              <p className="text-sm font-medium text-foreground">
                {gate.employee ? t("fields.hoursFor", { name: gate.employee.name }) : t("fields.hoursAny")}
              </p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS_ORDER.map((weekday) => {
                  const on = days.includes(weekday);
                  return (
                    <button
                      key={weekday}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setDays((cur) =>
                          cur.includes(weekday)
                            ? cur.filter((d) => d !== weekday)
                            : [...cur, weekday],
                        )
                      }
                      className={
                        "min-h-[40px] rounded-lg border px-3 text-sm font-medium transition " +
                        (on
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-border text-secondary-foreground hover:bg-hover")
                      }
                    >
                      {tShort(String(weekday))}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-end gap-3">
                {/* The select sits INSIDE its label: TimeSelect takes no id, and
                    an unassociated label names nothing to a screen reader. */}
                <label>
                  <span className={labelCls}>{t("fields.opensAt")}</span>
                  <TimeSelect value={opensAt} onChange={setOpensAt} />
                </label>
                <label>
                  <span className={labelCls}>{t("fields.closesAt")}</span>
                  <TimeSelect value={closesAt} onChange={setClosesAt} />
                </label>
              </div>
            </>
          )}

          {gate.current === "link" && (
            <div>
              <label className={labelCls} htmlFor="setup-link">
                {t("fields.link")}
              </label>
              <input
                id="setup-link"
                type="text"
                readOnly
                value={gate.bookingUrl}
                onFocus={(e) => e.currentTarget.select()}
                className={inputCls + " font-mono text-xs"}
              />
              <button
                type="button"
                onClick={copyLink}
                className="mt-2 min-h-[40px] rounded-lg border border-border px-3 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
              >
                {copied ? t("fields.copied") : t("fields.copy")}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (gate.current === "profile") {
                return submit(() => saveSetupProfile({ phone, address }));
              }
              if (gate.current === "service") {
                return submit(() =>
                  saveSetupService({
                    name: serviceName,
                    priceAzn: Number(price.replace(",", ".")),
                    durationMin: Number(duration),
                  }),
                );
              }
              if (gate.current === "master") {
                return submit(() => saveSetupMaster({ name: masterName }));
              }
              if (gate.current === "hours") {
                const employee = gate.employee;
                if (!employee) return fail(t("failed"));
                return submit(() =>
                  saveSetupHours({
                    employeeId: employee.id,
                    weekdays: days,
                    startMin: hhmmToMin(opensAt),
                    endMin: hhmmToMin(closesAt),
                  }),
                );
              }
              return submit(finishSetup);
            }}
            className="min-h-[44px] w-full rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? t("saving") : gate.current === "link" ? t("finish") : t("next")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onLogout}
            className="min-h-[40px] w-full rounded-lg px-4 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60"
          >
            {t("logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
