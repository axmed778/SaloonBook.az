"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";

export default function LoginPage() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("login.failed"));
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
        <h1 className="text-2xl font-bold">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t("login.subtitle")}</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
              autoComplete="current-password"
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? t("login.submitting") : t("login.submit")}
        </button>

        <Link
          href="/forgot-password"
          className="text-sm font-medium text-emerald-600 hover:underline"
        >
          {t("login.forgot")}
        </Link>
      </form>

      <p className="text-sm text-neutral-500">
        {t("login.noAccount")}{" "}
        <Link href="/register" className="font-medium text-emerald-600 hover:underline">
          {t("login.registerLink")}
        </Link>
      </p>
    </main>
  );
}
