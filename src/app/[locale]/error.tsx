"use client";

import { useEffect } from "react";

// Route-segment error boundary for the public pages: a rendering/data error
// shows a recoverable AZ message instead of a white screen. Server-side
// details are captured separately by instrumentation.onRequestError.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Nəsə xəta baş verdi</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Gözlənilməz xəta yarandı. Yenidən cəhd edin — problem davam edərsə, bir az
        sonra qayıdın.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-faint-foreground">Xəta kodu: {error.digest}</p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Yenidən cəhd et
        </button>
        <a
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          Ana səhifə
        </a>
      </div>
    </main>
  );
}
