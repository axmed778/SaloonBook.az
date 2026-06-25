"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PASSWORD_RULES = [
  "Ən az 8 simvol",
  "Ən az bir kiçik hərf",
  "Ən az bir böyük hərf",
  "Ən az bir rəqəm",
  "Ən az bir xüsusi simvol",
];

export default function RegisterPage() {
  const router = useRouter();
  const [salonName, setSalonName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues([]);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonName, fullName, email, password, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Qeydiyyat alınmadı.");
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
      setError("Şəbəkə xətası. Yenidən cəhd edin.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold">Salon qeydiyyatı</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Salonunuz üçün hesab yaradın və idarə panelinə daxil olun.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Salon adı
          <input
            type="text"
            required
            value={salonName}
            onChange={(e) => setSalonName(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Adınız (istəyə bağlı)
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          E-poçt
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Şifrə
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 pr-16 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-2 my-auto h-fit text-xs font-medium text-emerald-600 hover:underline"
            >
              {showPassword ? "Gizlət" : "Göstər"}
            </button>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Şifrəni təsdiqləyin
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <ul className="list-disc pl-5 text-xs text-neutral-500">
          {PASSWORD_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>

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
          {submitting ? "Yaradılır…" : "Qeydiyyatdan keç"}
        </button>
      </form>

      <p className="text-sm text-neutral-500">
        Artıq hesabınız var?{" "}
        <a href="/login" className="font-medium text-emerald-600 hover:underline">
          Daxil olun
        </a>
      </p>
    </main>
  );
}
