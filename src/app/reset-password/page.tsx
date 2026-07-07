"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// useSearchParams requires a Suspense boundary during prerender in Next 15.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
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
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Şifrəni yeniləmək alınmadı.");
        if (Array.isArray(data.issues)) setIssues(data.issues);
        return;
      }
      // The reset also signs the user in.
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Şəbəkə xətası. Yenidən cəhd edin.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-2xl font-bold">Link etibarsızdır</h1>
        <p className="text-sm text-neutral-500">
          Bərpa linki tapılmadı və ya natamamdır.{" "}
          <a href="/forgot-password" className="font-medium text-emerald-600 hover:underline">
            Yenidən bərpa tələb edin
          </a>
          .
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold">Yeni şifrə</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Hesabınız üçün yeni şifrə təyin edin. Ən az 8 simvol: böyük və kiçik
          hərf, rəqəm və xüsusi simvol.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Yeni şifrə
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
              {showPassword ? "Gizlət" : "Göstər"}
            </button>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Şifrəni təkrarlayın
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
        </label>

        {error && (
          <div className="text-sm text-red-600">
            <p>{error}</p>
            {issues.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Yenilənir…" : "Şifrəni yenilə"}
        </button>
      </form>
    </main>
  );
}
