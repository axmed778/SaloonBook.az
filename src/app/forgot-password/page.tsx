"use client";

import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Çox sayda cəhd. Bir az sonra yenidən yoxlayın.");
        return;
      }
      // The endpoint always answers generically — show the same success state.
      setSent(true);
    } catch {
      setError("Şəbəkə xətası. Yenidən cəhd edin.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold">Şifrənin bərpası</h1>
        <p className="mt-1 text-sm text-neutral-500">
          E-poçt ünvanınızı yazın — bərpa linki göndərək.
        </p>
      </div>

      {sent ? (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 p-4 text-sm">
          Əgər bu e-poçt qeydiyyatdadırsa, bərpa linki göndərildi. Gələnlər
          qutusunu (və spam qovluğunu) yoxlayın — link 60 dəqiqə etibarlıdır.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            E-poçt
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? "Göndərilir…" : "Bərpa linki göndər"}
          </button>
        </form>
      )}

      <p className="text-sm text-neutral-500">
        Şifrəniz yadınıza düşdü?{" "}
        <a href="/login" className="font-medium text-emerald-600 hover:underline">
          Daxil olun
        </a>
      </p>
    </main>
  );
}
