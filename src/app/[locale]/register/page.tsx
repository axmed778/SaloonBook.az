"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { AUDIENCE_OPTIONS, type Audience } from "@/lib/audience";
import { LEGAL_DOCS } from "@/lib/legal";

export default function RegisterPage() {
  const t = useTranslations("Auth");
  const tAudience = useTranslations("Audience");
  const PASSWORD_RULES = t.raw("passwordRules") as string[];
  const router = useRouter();
  const [salonName, setSalonName] = useState("");
  const [audience, setAudience] = useState<Audience>("ALL");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [legalConsent, setLegalConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues([]);
    if (!legalConsent) {
      setError(t("register.consentRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonName,
          audience,
          fullName,
          email,
          password,
          confirmPassword,
          legalConsent: true,
          marketing: marketingConsent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("register.failed"));
        if (Array.isArray(data.issues)) {
          setIssues(
            data.issues
              .map((i: unknown) =>
                typeof i === "string" ? i : (i as { message?: string }).message,
              )
              .filter(Boolean) as string[],
          );
        }
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold">{t("register.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t("register.subtitle")}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          {t("register.salonName")}
          <input
            type="text"
            required
            value={salonName}
            onChange={(e) => setSalonName(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          {t("register.audienceLabel")}
          <div className="mt-1 inline-flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-700">
            {AUDIENCE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setAudience(o.value)}
                className={
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition " +
                  (audience === o.value
                    ? "bg-emerald-600 text-white"
                    : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100")
                }
              >
                {tAudience(o.value)}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          {t("register.fullName")}
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("emailLabel")}
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("passwordLabel")}
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 pr-16 text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-2 my-auto h-fit text-xs font-medium text-emerald-600 hover:underline"
            >
              {showPassword ? t("hide") : t("show")}
            </button>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t("register.confirmPassword")}
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
        </label>

        <ul className="list-disc pl-5 text-xs text-neutral-500">
          {PASSWORD_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
            <input
              type="checkbox"
              checked={legalConsent}
              onChange={(e) => setLegalConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
            />
            <span>
              {t.rich("register.legalConsent", {
                offer: (chunks) => (
                  <a
                    href={LEGAL_DOCS.salonOffer}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-emerald-600 underline"
                  >
                    {chunks}
                  </a>
                ),
                privacy: (chunks) => (
                  <a
                    href={LEGAL_DOCS.salonConsents}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-emerald-600 underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
            />
            <span>{t("register.marketingConsent")}</span>
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {issues.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-red-600">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? t("register.submitting") : t("register.submit")}
        </button>
      </form>

      <p className="text-sm text-neutral-500">
        {t("register.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-emerald-600 hover:underline">
          {t("register.loginLink")}
        </Link>
      </p>
    </main>
  );
}
