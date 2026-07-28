"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { submitReview } from "./actions";

// Inline review form shown under a completed, un-reviewed visit. Star rating +
// optional comment. On success it refreshes the history so the CTA disappears.
export function ReviewForm({
  appointmentId,
  onCancel,
}: {
  appointmentId: string;
  onCancel?: () => void;
}) {
  const t = useTranslations("Reviews");
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (rating < 1) return;
    setError(null);
    start(async () => {
      const res = await submitReview({
        appointmentId,
        rating,
        comment: comment.trim() || undefined,
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t("errors.failed"));
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">{t("prompt")}</p>

      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            aria-label={t("stars", { n })}
            className="text-2xl leading-none transition"
          >
            <span className={(hover || rating) >= n ? "text-amber-400" : "text-border-strong"}>
              ★
            </span>
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("commentPlaceholder")}
        maxLength={1000}
        className="mt-2 min-h-[64px] w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none"
      />

      {error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={pending || rating < 1}
          className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
          >
            {t("cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
