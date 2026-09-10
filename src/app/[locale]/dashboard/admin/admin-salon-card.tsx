"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useModalA11y } from "@/components/use-modal-a11y";
import { getAccountDetails, type AdminSalonDetails } from "./actions";

// The read-only half of the admin panel: click a salon, see everything you'd
// otherwise open psql for — when the subscription started and how long it has
// left, every branch with its address and phone, who works there, and who to
// call. Fetched when the modal opens (see getAccountDetails for why) so the
// table above stays a cheap query.

type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; details: AdminSalonDetails };

export function SalonCardModal({
  accountId,
  name,
  onClose,
}: {
  accountId: string;
  name: string;
  onClose: () => void;
}) {
  const t = useTranslations("Admin");
  const { titleId, dialogProps } = useModalA11y(onClose);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    getAccountDetails({ accountId })
      .then((res) => {
        if (!live) return;
        setState(
          res.ok
            ? { status: "ready", details: res.details }
            : { status: "error", error: res.error },
        );
      })
      .catch(() => {
        if (live) setState({ status: "error", error: "" });
      });
    return () => {
      live = false;
    };
  }, [accountId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        {...dialogProps}
        className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {t("details.title", { name })}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg border border-border-strong px-2.5 py-1 text-xs text-secondary-foreground transition hover:border-border-strong"
          >
            {t("close")}
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {state.status === "loading" && (
            <p className="py-8 text-center text-sm text-faint-foreground">
              {t("details.loading")}
            </p>
          )}
          {state.status === "error" && (
            <p className="py-8 text-center text-sm text-rose-700 dark:text-rose-400">
              {state.error || t("errors.invalidData")}
            </p>
          )}
          {state.status === "ready" && <Body d={state.details} />}
        </div>
      </div>
    </div>
  );
}

function Body({ d }: { d: AdminSalonDetails }) {
  const t = useTranslations("Admin");
  const ta = useTranslations("Audience");
  const s = d.subscription;

  return (
    <div className="space-y-6">
      {/* --- Subscription -------------------------------------------------- */}
      <Section title={t("details.sectionSubscription")}>
        <Fields>
          <Field label={t("colPlan")}>
            {s.plan}
            {s.effective !== s.plan && (
              <span
                className="ml-1.5 text-xs text-amber-700 dark:text-amber-400"
                title={t("effectiveTooltip")}
              >
                → {s.effective}
              </span>
            )}
          </Field>
          <Field label={t("colStatus")}>
            {s.status
              ? t.has(`subStatus.${s.status}`)
                ? t(`subStatus.${s.status}`)
                : s.status
              : t("details.noSub")}
          </Field>
          <Field label={t("details.remaining")}>
            <Remaining s={s} />
          </Field>
          <Field label={t("details.subStarted")}>{s.startedLabel ?? "—"}</Field>
          <Field label={t("details.periodStart")}>{s.periodStartLabel ?? "—"}</Field>
          <Field label={t("details.endsAt")}>{s.endsLabel ?? "—"}</Field>
          <Field label={t("details.branches")}>
            {t("branchesUsage", { count: s.branchCount, limit: s.branchLimit })}
            {s.extraBranches > 0 && (
              <span className="ml-1.5 text-xs text-faint-foreground">
                {t("details.extras", { count: s.extraBranches })}
              </span>
            )}
          </Field>
          <Field label={t("details.paid")}>
            {t("details.paidValue", {
              amount: (s.totalPaidMinor / 100).toFixed(2),
              count: s.paymentsCount,
            })}
          </Field>
          <Field label={t("details.staff")}>
            {t("details.staffValue", { active: d.employeesActive, total: d.employeesTotal })}
          </Field>
        </Fields>
      </Section>

      {/* --- Account & contacts -------------------------------------------- */}
      <Section title={t("details.sectionAccount")}>
        <Fields>
          <Field label={t("details.accountName")}>{d.account.name}</Field>
          <Field label={t("details.accountCreated")}>{d.account.createdLabel}</Field>
          <Field label={t("details.accountStatus")}>
            {t.has(`details.accStatus.${d.account.status}`)
              ? t(`details.accStatus.${d.account.status}`)
              : d.account.status}
          </Field>
          <Field label={t("details.legalAccepted")}>
            {d.account.legalAcceptedLabel ?? "—"}
          </Field>
        </Fields>

        {d.owners.length === 0 ? (
          <p className="mt-3 text-sm text-faint-foreground">{t("details.noOwner")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {d.owners.map((o) => (
              <li
                key={o.email}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 text-sm"
              >
                <span className="font-medium text-foreground">
                  {o.name || t("details.ownerNoName")}
                </span>
                <a
                  href={`mailto:${o.email}`}
                  className="text-secondary-foreground underline-offset-2 hover:underline"
                >
                  {o.email}
                </a>
                {o.phone ? (
                  <a
                    href={`tel:${o.phone}`}
                    className="text-secondary-foreground underline-offset-2 hover:underline"
                  >
                    {o.phone}
                  </a>
                ) : (
                  <span className="text-faint-foreground">{t("details.noPhone")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* --- Branches ------------------------------------------------------- */}
      <Section title={t("details.sectionBranches", { count: d.branches.length })}>
        {d.branches.length === 0 ? (
          <p className="text-sm text-faint-foreground">{t("details.noBranches")}</p>
        ) : (
          <div className="space-y-3">
            {d.branches.map((b) => (
              <div key={b.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="font-medium text-foreground">{b.name}</p>
                  <a
                    href={`/${b.slug}`}
                    target="_blank"
                    className="text-xs text-faint-foreground underline-offset-2 hover:underline"
                  >
                    /{b.slug}
                  </a>
                  {b.status !== "ACTIVE" && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                      {t.has(`details.salonStatus.${b.status}`)
                        ? t(`details.salonStatus.${b.status}`)
                        : b.status}
                    </span>
                  )}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {ta(b.audience as "MALE" | "FEMALE" | "ALL")}
                  </span>
                </div>

                <Fields className="mt-2">
                  <Field label={t("details.phone")}>
                    {b.phone ? (
                      <a
                        href={`tel:${b.phone}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {b.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </Field>
                  <Field label={t("details.address")}>
                    {b.address || "—"}
                    {b.district && (
                      <span className="text-faint-foreground"> · {b.district}</span>
                    )}
                  </Field>
                  <Field label={t("details.pin")}>
                    {b.mapUrl ? (
                      <a
                        href={b.mapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-secondary-foreground underline-offset-2 hover:underline"
                      >
                        {t("details.openMap")}
                      </a>
                    ) : (
                      <span className="text-faint-foreground">{t("details.noPin")}</span>
                    )}
                  </Field>
                  <Field label={t("details.created")}>{b.createdLabel}</Field>
                  <Field label={t("colBookings")}>{b.bookingsThisMonth}</Field>
                  <Field label={t("details.staff")}>
                    {t("details.staffValue", {
                      active: b.employees.filter((e) => e.isActive).length,
                      total: b.employees.length,
                    })}
                  </Field>
                </Fields>

                {b.employees.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {b.employees.map((e) => (
                      <li
                        key={e.id}
                        className={
                          "rounded-lg px-2 py-1 text-xs " +
                          (e.isActive
                            ? "bg-muted text-secondary-foreground"
                            : "bg-muted text-faint-foreground line-through")
                        }
                        title={e.phone ?? undefined}
                      >
                        {e.name}
                        {e.position && (
                          <span className="text-faint-foreground"> · {e.position}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** The days-left line: the one number an admin actually calls about. */
function Remaining({ s }: { s: AdminSalonDetails["subscription"] }) {
  const t = useTranslations("Admin");
  if (s.basis === "open") {
    return <span className="text-emerald-600 dark:text-emerald-400">{t("details.openEnded")}</span>;
  }
  if (s.daysLeft === null) return <span className="text-faint-foreground">—</span>;
  if (s.daysLeft > 0) {
    return (
      <span
        className={
          s.daysLeft <= 7
            ? "font-medium text-amber-700 dark:text-amber-400"
            : "font-medium text-emerald-600 dark:text-emerald-400"
        }
      >
        {t("details.daysLeft", { days: s.daysLeft })}
      </span>
    );
  }
  if (s.daysLeft === 0) {
    return (
      <span className="font-medium text-amber-700 dark:text-amber-400">
        {t("details.endsToday")}
      </span>
    );
  }
  return (
    <span className="font-medium text-rose-700 dark:text-rose-400">
      {s.inGrace
        ? t("details.inGrace", { days: s.graceDaysLeft })
        : t("details.expired", { days: -s.daysLeft })}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fields({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 ${className}`}>{children}</dl>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint-foreground">{label}</dt>
      <dd className="truncate text-sm text-foreground">{children}</dd>
    </div>
  );
}
