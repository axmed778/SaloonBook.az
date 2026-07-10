"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

// Dashboard-segment error boundary: renders inside the sidebar shell, so a
// broken screen doesn't take the whole panel down with it.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("AppError");

  useEffect(() => {
    console.error("[dashboard-error-boundary]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-xl font-semibold text-zinc-100">{t("title")}</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">{t("dashboardBody")}</p>
      {error.digest && (
        <p className="mt-2 text-xs text-zinc-600">
          {t("errorCode")}: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="mt-5 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
      >
        {t("tryAgain")}
      </button>
    </div>
  );
}
