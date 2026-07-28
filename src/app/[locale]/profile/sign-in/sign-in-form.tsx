"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { LEGAL_DOCS } from "@/lib/legal";

type Step = "phone" | "code";
type Channel = "whatsapp" | "sms";

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";

export function SignInForm() {
  const t = useTranslations("ClientAuth");
  const router = useRouter();

  const [step, setStep] = useState<Step>("phone");
  const [local, setLocal] = useState(""); // 9 digits after +994
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const phone = `+994${local}`;
  const phoneValid = /^\d{9}$/.test(local);

  // Resend cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Map an API error code to a localized message (t.has falls back gracefully).
  function msg(codeKey: string): string {
    return t.has(`errors.${codeKey}`) ? t(`errors.${codeKey}`) : t("errors.generic");
  }

  async function requestCode(forceSms: boolean) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await fetch("/api/client/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, consent: true, sms: forceSms }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        channel?: Channel;
        error?: string;
        retryAfterSec?: number;
      };
      if (!res.ok) {
        if (data.error === "cooldown") {
          // A code was just sent — move to the code step and count down.
          setStep("code");
          setCooldown(data.retryAfterSec ?? 60);
          setInfo(t("codeAlreadySent"));
          return;
        }
        setError(msg(data.error ?? "generic"));
        return;
      }
      setChannel(data.channel ?? "whatsapp");
      setStep("code");
      setCooldown(60);
      setCode("");
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/client/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(msg(data.error ?? "generic"));
        return;
      }
      router.push("/profile");
      router.refresh();
    } catch {
      setError(t("errors.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {step === "phone" ? t("subtitle") : t("codeSubtitle", { phone })}
        </p>
      </div>

      {step === "phone" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (phoneValid && consent) void requestCode(false);
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1 text-sm text-secondary-foreground">
            {t("phoneLabel")}
            <div className="flex items-stretch gap-2">
              <span className="flex items-center rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
                +994
              </span>
              <input
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder={t("phonePlaceholder")}
                value={local}
                onChange={(e) => setLocal(e.target.value.replace(/\D/g, "").slice(0, 9))}
                className={inputCls}
              />
            </div>
          </label>

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded accent-rose-500"
            />
            <span>
              {t.rich("consent", {
                a: (chunks) => (
                  <a
                    href={LEGAL_DOCS.clientConsents}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-rose-700 underline dark:text-rose-400"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </span>
          </label>

          {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || !phoneValid || !consent}
            className="rounded-lg bg-rose-500 px-4 py-2 font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
          >
            {busy ? t("sending") : t("sendCode")}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code)) void verify();
          }}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-faint-foreground">
            {channel === "sms" ? t("sentViaSms") : t("sentViaWhatsapp")}
          </p>
          {info && <p className="text-sm text-faint-foreground">{info}</p>}

          <label className="flex flex-col gap-1 text-sm text-secondary-foreground">
            {t("codeLabel")}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={inputCls + " text-center text-lg tracking-[0.4em]"}
            />
          </label>

          {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || !/^\d{6}$/.test(code)}
            className="rounded-lg bg-rose-500 px-4 py-2 font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
          >
            {busy ? t("verifying") : t("verify")}
          </button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => void requestCode(false)}
              className="font-medium text-rose-700 hover:underline disabled:text-faint-foreground disabled:no-underline dark:text-rose-400"
            >
              {cooldown > 0 ? t("resendIn", { sec: cooldown }) : t("resend")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void requestCode(true)}
              className="font-medium text-muted-foreground hover:text-foreground"
            >
              {t("sendViaSms")}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setError(null);
              setInfo(null);
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("changeNumber")}
          </button>
        </form>
      )}

      <p className="text-center text-xs text-faint-foreground">
        <Link href="/" className="hover:text-foreground">
          {t("backHome")}
        </Link>
      </p>
    </main>
  );
}
