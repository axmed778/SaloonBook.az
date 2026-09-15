"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TimeOffModal, type TimeOffRow } from "../_components/time-off-modal";

type EmployeeTimeOff = {
  id: string;
  name: string;
  position: string | null;
  timeOff: TimeOffRow[];
};

export function TimeOffBoard({
  employees,
  canEdit,
}: {
  employees: EmployeeTimeOff[];
  canEdit: boolean;
}) {
  const t = useTranslations("TimeOff");
  const [openId, setOpenId] = useState<string | null>(null);
  // Resolved from props on every render, so the modal shows an add or delete as
  // soon as the page refreshes.
  const open = employees.find((e) => e.id === openId) ?? null;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-faint-foreground">{t("subtitle")}</p>
      </div>

      {employees.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-xl border border-dashed border-border text-center">
          <p className="text-sm text-faint-foreground">{t("empty")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {employees.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                  {e.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{e.name}</p>
                  <p className="mt-0.5 truncate text-sm text-faint-foreground">
                    {e.position || "—"}
                    <span> · </span>
                    {t("upcoming", { count: e.timeOff.length })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpenId(e.id)}
                className="shrink-0 text-sm text-muted-foreground transition hover:text-foreground"
              >
                {canEdit ? t("manage") : t("view")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && <TimeOffModal employee={open} canEdit={canEdit} onClose={() => setOpenId(null)} />}
    </div>
  );
}
