"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Route-segment error boundary for the public pages: a rendering/data error
// shows a recoverable message instead of a white screen. Server-side details
// are captured separately by instrumentation.onRequestError.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("AppError");

  useEffect(() => {
    console.error("[error-boundary]", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("publicBody")}</p>
      {error.digest && (
        <p className="mt-2 text-xs text-faint-foreground">
          {t("errorCode")}: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          {t("tryAgain")}
        </button>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
