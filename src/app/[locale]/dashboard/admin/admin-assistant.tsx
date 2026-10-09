"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { PLAN_LIMITS } from "@/lib/plans";
import type { ChatTurn, Proposal } from "@/lib/admin-assistant/tools";
import { askAssistant } from "./assistant";
import {
  activateSubscription,
  disableWhatsAppSender,
  grantTrial,
  setExtraBranches,
  type ActionResult,
} from "./actions";

// The admin assistant panel: a chat with Claude about the platform's data.
// Claude only answers and proposes; a proposal runs when the admin presses
// Confirm on its card, through the same server action as the manual buttons.

const PLAN_NAMES: Record<string, string> = {
  START: "Start",
  BASIC: "Salon",
  PRO: "Pro",
};

type Turn = ChatTurn & { proposals?: Proposal[] };
type CardState = {
  status: "open" | "running" | "done" | "dismissed";
  error?: string;
};

function runProposal(p: Proposal): Promise<ActionResult> {
  switch (p.kind) {
    case "activate_subscription":
      return activateSubscription(p.args);
    case "grant_trial":
      return grantTrial(p.args);
    case "set_extra_branches":
      return setExtraBranches(p.args);
    case "disable_whatsapp_sender":
      return disableWhatsAppSender(p.args);
  }
}

export function AdminAssistant() {
  const t = useTranslations("Admin.assistant");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns, pending]);

  function describe(p: Proposal): string {
    switch (p.kind) {
      case "activate_subscription": {
        const amount =
          p.args.amountMinor ??
          PLAN_LIMITS[p.args.plan].priceMinor * p.args.months;
        return t("proposal.activate", {
          salon: p.salonName,
          plan: PLAN_NAMES[p.args.plan],
          months: p.args.months,
          amount: (amount / 100).toFixed(2),
        });
      }
      case "grant_trial":
        return t("proposal.trial", {
          salon: p.salonName,
          plan: PLAN_NAMES[p.args.plan],
          days: p.args.days,
        });
      case "set_extra_branches":
        return t("proposal.branches", {
          salon: p.salonName,
          count: p.args.extraBranches,
        });
      case "disable_whatsapp_sender":
        return t("proposal.disableSender", { salon: p.salonName });
    }
  }

  function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    // History goes back as plain text; proposals stay in the browser.
    const history: ChatTurn[] = turns.map(({ role, text }) => ({
      role,
      text: text.slice(0, 4000),
    }));
    setTurns((prev) => [...prev, { role: "user", text: q }]);
    setQuestion("");
    startTransition(async () => {
      const res = await askAssistant({ history, question: q });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: res.answer, proposals: res.proposals },
      ]);
    });
  }

  function confirm(p: Proposal) {
    setCards((c) => ({ ...c, [p.id]: { status: "running" } }));
    startTransition(async () => {
      const res = await runProposal(p);
      if (!res.ok) {
        setCards((c) => ({
          ...c,
          [p.id]: { status: "open", error: res.error },
        }));
        return;
      }
      setCards((c) => ({ ...c, [p.id]: { status: "done" } }));
      // Claude sees what was actually done on the next question.
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: t("doneNote", { what: describe(p) }) },
      ]);
      router.refresh();
    });
  }

  function dismiss(p: Proposal) {
    setCards((c) => ({ ...c, [p.id]: { status: "dismissed" } }));
    setTurns((prev) => [
      ...prev,
      { role: "assistant", text: t("dismissedNote", { what: describe(p) }) },
    ]);
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-foreground">
            {t("title")}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {t("subtitle")}
          </span>
        </span>
        <span aria-hidden className="text-muted-foreground">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border p-4">
          <div className="max-h-[28rem] space-y-3 overflow-y-auto">
            {turns.length === 0 && (
              <p className="text-sm text-faint-foreground">{t("empty")}</p>
            )}
            {turns.map((turn, i) => (
              <div
                key={i}
                className={turn.role === "user" ? "flex justify-end" : ""}
              >
                <div
                  className={
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap " +
                    (turn.role === "user"
                      ? "bg-rose-600 text-white"
                      : "border border-border bg-background text-foreground")
                  }
                >
                  {turn.text}
                </div>
                {turn.proposals?.map((p) => {
                  const card = cards[p.id] ?? { status: "open" };
                  return (
                    <div
                      key={p.id}
                      className="mt-2 max-w-[85%] rounded-lg border border-amber-500/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/30"
                    >
                      <p className="font-medium text-foreground">
                        {describe(p)}
                      </p>
                      {p.reason && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {p.reason}
                        </p>
                      )}
                      {card.error && (
                        <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">
                          {card.error}
                        </p>
                      )}
                      {card.status === "done" ? (
                        <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          {t("done")}
                        </p>
                      ) : card.status === "dismissed" ? (
                        <p className="mt-2 text-xs text-faint-foreground">
                          {t("dismissed")}
                        </p>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => confirm(p)}
                            disabled={pending}
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
                          >
                            {card.status === "running"
                              ? tc("pleaseWait")
                              : t("confirm")}
                          </button>
                          <button
                            type="button"
                            onClick={() => dismiss(p)}
                            disabled={pending}
                            className="rounded-lg border border-border-strong px-3 py-1.5 text-xs text-secondary-foreground transition hover:border-border-strong disabled:opacity-60"
                          >
                            {tc("cancel")}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {pending && (
              <p className="text-sm text-muted-foreground">{t("thinking")}</p>
            )}
            <div ref={endRef} />
          </div>

          {error && (
            <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">
              {error}
            </p>
          )}

          <form onSubmit={ask} className="mt-3 flex gap-2">
            <label className="flex-1">
              <span className="sr-only">{t("inputLabel")}</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder={t("placeholder")}
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={pending || question.trim() === ""}
              className="self-end rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {t("send")}
            </button>
          </form>
          <p className="mt-2 text-xs text-faint-foreground">{t("footnote")}</p>
        </div>
      )}
    </section>
  );
}
