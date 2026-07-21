"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Subtle segmented toggle embedded in the Pro pricing card's WhatsApp row: it
 * lets a prospect flip between sending from OUR shared number (with the monthly
 * reminder quota) and their OWN number (unlimited — they pay Meta directly).
 * Display-only; it just swaps the value line under it.
 */
export function ProWhatsAppToggle({
  label,
  ourLabel,
  ownLabel,
  ourValue,
  ownValue,
  ownNote,
}: {
  label: string;
  ourLabel: string;
  ownLabel: string;
  ourValue: string;
  ownValue: string;
  ownNote: string;
}) {
  const [own, setOwn] = useState(false);

  const seg = "rounded-full px-2 py-0.5 transition-colors";
  return (
    <span className="flex flex-col gap-1.5">
      <span className="text-foreground">{label}</span>
      <span
        role="tablist"
        aria-label={label}
        className="inline-flex w-fit items-center gap-0.5 rounded-full border border-border bg-muted/60 p-0.5 text-[11px] font-medium"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!own}
          onClick={() => setOwn(false)}
          className={cn(
            seg,
            !own
              ? "bg-card text-foreground shadow-sm"
              : "text-faint-foreground hover:text-muted-foreground",
          )}
        >
          {ourLabel}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={own}
          onClick={() => setOwn(true)}
          className={cn(
            seg,
            own
              ? "bg-accent/15 text-accent"
              : "text-faint-foreground hover:text-muted-foreground",
          )}
        >
          {ownLabel}
        </button>
      </span>
      <span className="text-muted-foreground">— {own ? ownValue : ourValue}</span>
      {own && (
        <span className="text-xs leading-snug text-faint-foreground">{ownNote}</span>
      )}
    </span>
  );
}
