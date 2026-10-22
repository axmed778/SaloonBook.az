import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuYmd, formatBakuDate } from "@/lib/time";
import { intlLocale } from "@/i18n/format";
import { agentRewardDue } from "@/lib/referral";
import { AgentsPanel, type AgentRow } from "./agents-panel";

export const dynamic = "force-dynamic";

// Sales agents (platform admin only): each agent's referral code and link,
// the salons they brought in, whether each has paid, and the one-off reward
// owed or already paid out (src/lib/referral.ts).

export default async function AgentsPage() {
  const session = (await getSession())!;
  if (!session.isAdmin) notFound();
  const df = intlLocale(await getLocale());

  const [agents, accounts, planPaidBySub] = await Promise.all([
    prisma.agent.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, code: true, name: true, phone: true },
    }),
    prisma.account.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        agentId: true,
        agentRewardPaidAt: true,
        agentRewardMinor: true,
        subscription: { select: { id: true, plan: true, status: true } },
        salons: { select: { name: true }, take: 1 },
      },
    }),
    // Plan payments only: what makes a referred salon count as paying.
    prisma.payment.groupBy({
      by: ["subscriptionId"],
      where: { purpose: "plan" },
      _sum: { amountMinor: true },
    }),
  ]);

  const planPaidBySubId = new Map(
    planPaidBySub.map((p) => [p.subscriptionId, p._sum.amountMinor ?? 0]),
  );
  const rows: AgentRow[] = agents.map((agent) => {
    const salons = accounts
      .filter((a) => a.agentId === agent.id)
      .map((a) => {
        const sub = a.subscription;
        const paidMinor = sub ? (planPaidBySubId.get(sub.id) ?? 0) : 0;
        return {
          accountId: a.id,
          salonName: a.salons[0]?.name ?? a.name,
          status: sub?.status ?? null,
          plan: sub?.plan ?? "FREE",
          paidMinor,
          dueMinor: sub ? agentRewardDue({ plan: sub.plan, paidMinor }) : 0,
          paidOutMinor: a.agentRewardPaidAt ? (a.agentRewardMinor ?? 0) : null,
          paidOutLabel: a.agentRewardPaidAt
            ? formatBakuDate(bakuYmd(a.agentRewardPaidAt), df)
            : null,
        };
      });
    return { ...agent, salons };
  });
  const options = accounts.map((a) => ({
    accountId: a.id,
    label: a.salons[0]?.name ?? a.name,
    agentId: a.agentId,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <AgentsPanel agents={rows} accounts={options} />
    </div>
  );
}
