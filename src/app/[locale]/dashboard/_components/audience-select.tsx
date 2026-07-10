"use client";

import { useTranslations } from "next-intl";
import { AUDIENCE_OPTIONS, type Audience } from "@/lib/audience";

// Segmented control for choosing a gender audience (Everyone / Men / Women).
export function AudienceSelect({
  value,
  onChange,
  label,
}: {
  value: Audience;
  onChange: (a: Audience) => void;
  label?: string;
}) {
  const t = useTranslations("Common");
  const tAudience = useTranslations("Audience");
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-zinc-400">
        {label ?? t("audienceFor")}
      </label>
      <div className="inline-flex rounded-lg border border-zinc-800 p-0.5">
        {AUDIENCE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium transition " +
              (value === o.value
                ? "bg-rose-500 text-white"
                : "text-zinc-400 hover:text-zinc-100")
            }
          >
            {tAudience(o.value)}
          </button>
        ))}
      </div>
    </div>
  );
}
