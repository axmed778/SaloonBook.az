"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createAgent, setAccountAgent, setAgentRewardPaid } from "./actions";

export type AgentRow = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  salons: {
    accountId: string;
    salonName: string;
    status: string | null;
    plan: string;
    /** Lifetime money received from the salon, in qəpik. */
    paidMinor: number;
    /** Reward owed for it right now, in qəpik (0 until the salon pays). */
    dueMinor: number;
    /** Frozen payout amount once paid out; null while not paid out. */
    paidOutMinor: number | null;
    paidOutLabel: string | null;
  }[];
};

export type AgentAccountOption = { accountId: string; label: string; agentId: string | null };

const inputClass =
  "rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none";
const primaryBtn =
  "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60";
const ghostBtn =
  "rounded-lg border border-border-strong px-3 py-1.5 text-xs text-secondary-foreground transition disabled:opacity-60";

const azn = (minor: number) => (minor / 100).toFixed(0);

// Platform-admin view of the sales agents: who brought which salon, whether
// that salon has paid, and the one-off reward owed / already paid out.
export function AdminAgents({
  agents,
  accounts,
}: {
  agents: AgentRow[];
  accounts: AgentAccountOption[];
}) {
  const t = useTranslations("Admin.agents");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", phone: "" });
  const [assign, setAssign] = useState({ accountId: "", agentId: "" });

  useEffect(() => setOrigin(window.location.origin), []);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  const linkFor = (code: string) => `${origin}/register?ref=${code}`;

  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => createAgent(form),
            () => setForm({ name: "", code: "", phone: "" }),
          );
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("name")}
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("code")}
          <input
            required
            maxLength={20}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            className={inputClass + " uppercase"}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("phone")}
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={pending} className={primaryBtn}>
          {t("add")}
        </button>
      </form>

      {agents.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("noAgents")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {agents.map((agent) => {
            const paying = agent.salons.filter((s) => s.dueMinor > 0);
            const owed = agent.salons
              .filter((s) => s.paidOutMinor === null)
              .reduce((sum, s) => sum + s.dueMinor, 0);
            const paidOut = agent.salons.reduce((sum, s) => sum + (s.paidOutMinor ?? 0), 0);
            return (
              <div key={agent.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {agent.name}{" "}
                    <span className="font-mono text-xs text-muted-foreground">{agent.code}</span>
                    {agent.phone && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {agent.phone}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("salons", { total: agent.salons.length, paid: paying.length })} ·{" "}
                    <span
                      className={
                        owed > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : undefined
                      }
                    >
                      {t("due", { amount: azn(owed) })}
                    </span>{" "}
                    · {t("paidOut", { amount: azn(paidOut) })}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{t("link")}:</span>
                  <code className="break-all rounded bg-secondary px-1.5 py-0.5">
                    {linkFor(agent.code)}
                  </code>
                  <button
                    type="button"
                    className={ghostBtn}
                    onClick={() => {
                      void navigator.clipboard?.writeText(linkFor(agent.code));
                      setCopied(agent.id);
                    }}
                  >
                    {copied === agent.id ? t("copied") : t("copy")}
                  </button>
                </div>
                {agent.salons.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t("noSalons")}</p>
                ) : (
                  <table className="mt-3 w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 font-medium">{t("colSalon")}</th>
                        <th className="py-1 font-medium">{t("colStatus")}</th>
                        <th className="py-1 font-medium">{t("colPaid")}</th>
                        <th className="py-1 font-medium">{t("colReward")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agent.salons.map((s) => (
                        <tr key={s.accountId} className="border-t border-border">
                          <td className="py-1.5 pr-2 text-foreground">{s.salonName}</td>
                          <td className="py-1.5 pr-2">
                            {s.dueMinor > 0
                              ? `${t("statusPaid")} · ${s.plan}`
                              : s.status === "TRIALING"
                                ? t("statusTrial")
                                : t("statusNotPaid")}
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums">{azn(s.paidMinor)} ₼</td>
                          <td className="py-1.5">
                            {s.paidOutMinor !== null ? (
                              <span className="inline-flex flex-wrap items-center gap-2">
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  {t("paidOn", {
                                    amount: azn(s.paidOutMinor),
                                    date: s.paidOutLabel ?? "",
                                  })}
                                </span>
                                <button
                                  type="button"
                                  disabled={pending}
                                  className={ghostBtn}
                                  onClick={() =>
                                    run(() =>
                                      setAgentRewardPaid({ accountId: s.accountId, paid: false }),
                                    )
                                  }
                                >
                                  {t("unmarkPaid")}
                                </button>
                              </span>
                            ) : s.dueMinor > 0 ? (
                              <span className="inline-flex flex-wrap items-center gap-2">
                                <span className="font-semibold tabular-nums">
                                  {azn(s.dueMinor)} ₼
                                </span>
                                <button
                                  type="button"
                                  disabled={pending}
                                  className={primaryBtn}
                                  onClick={() =>
                                    run(() =>
                                      setAgentRewardPaid({ accountId: s.accountId, paid: true }),
                                    )
                                  }
                                >
                                  {t("markPaid")}
                                </button>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {agents.length > 0 && (
        <form
          className="mt-5 flex flex-wrap items-end gap-2 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!assign.accountId) return;
            run(() =>
              setAccountAgent({
                accountId: assign.accountId,
                agentId: assign.agentId || null,
              }),
            );
          }}
        >
          <p className="w-full text-xs font-semibold text-foreground">{t("assignTitle")}</p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("assignAccount")}
            <select
              required
              value={assign.accountId}
              onChange={(e) => {
                const accountId = e.target.value;
                const current = accounts.find((a) => a.accountId === accountId)?.agentId ?? "";
                setAssign({ accountId, agentId: current });
              }}
              className={inputClass}
            >
              <option value="" />
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("assignAgent")}
            <select
              value={assign.agentId}
              onChange={(e) => setAssign({ ...assign, agentId: e.target.value })}
              className={inputClass}
            >
              <option value="">{t("assignNone")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.code})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending || !assign.accountId} className={primaryBtn}>
            {t("assign")}
          </button>
        </form>
      )}
    </section>
  );
}
