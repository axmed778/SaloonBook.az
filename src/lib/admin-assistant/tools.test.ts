import { describe, expect, it } from "vitest";
import {
  ASSISTANT_HISTORY_TURNS,
  ASSISTANT_MAX_TEXT,
  ASSISTANT_TOOLS,
  buildMessages,
  parseProposal,
  proposalKindOf,
  proposalSchemas,
} from "./tools";

const ACC = "5b0c8a52-3f2e-4c8e-9a51-2f6c9b1d7e10";

describe("proposalKindOf", () => {
  it("maps every propose_* tool to a proposal kind", () => {
    const proposeTools = ASSISTANT_TOOLS.filter((t) =>
      t.name.startsWith("propose_"),
    );
    expect(proposeTools.map((t) => proposalKindOf(t.name)).sort()).toEqual(
      Object.keys(proposalSchemas).sort(),
    );
  });

  it("is null for read tools and unknown names", () => {
    expect(proposalKindOf("list_accounts")).toBeNull();
    expect(proposalKindOf("propose_delete_account")).toBeNull();
  });

  it("offers no destructive tool", () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name).join(" ");
    expect(names).not.toMatch(/delete|set_whatsapp_sender/);
  });
});

describe("parseProposal", () => {
  it("splits the reason off from the action's args", () => {
    const res = parseProposal("grant_trial", {
      accountId: ACC,
      plan: "PRO",
      days: 14,
      reason: "Попросили продлить",
    });
    expect(res).toEqual({
      ok: true,
      args: { accountId: ACC, plan: "PRO", days: 14 },
      reason: "Попросили продлить",
    });
  });

  it("rejects out-of-range values the server action would also refuse", () => {
    expect(
      parseProposal("activate_subscription", {
        accountId: ACC,
        plan: "PRO",
        months: 0,
      }).ok,
    ).toBe(false);
    expect(
      parseProposal("grant_trial", { accountId: ACC, plan: "FREE", days: 7 })
        .ok,
    ).toBe(false);
    expect(
      parseProposal("disable_whatsapp_sender", { salonId: "not-a-uuid" }).ok,
    ).toBe(false);
  });

  it("drops unknown keys rather than passing them to the action", () => {
    const res = parseProposal("set_extra_branches", {
      accountId: ACC,
      extraBranches: 2,
      password: "x",
    });
    expect(res.ok && res.args).toEqual({ accountId: ACC, extraBranches: 2 });
  });
});

describe("buildMessages", () => {
  it("appends the question after the history", () => {
    const msgs = buildMessages(
      [
        { role: "user", text: "Сколько салонов?" },
        { role: "assistant", text: "12" },
      ],
      "А на Pro?",
    );
    expect(msgs).toEqual([
      { role: "user", content: "Сколько салонов?" },
      { role: "assistant", content: "12" },
      { role: "user", content: "А на Pro?" },
    ]);
  });

  it("keeps only recent turns and still opens on a user turn", () => {
    const history = Array.from(
      { length: ASSISTANT_HISTORY_TURNS + 5 },
      (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `t${i}`,
      }),
    );
    const msgs = buildMessages(history, "q");
    expect(msgs[0].role).toBe("user");
    expect(msgs.length).toBeLessThanOrEqual(ASSISTANT_HISTORY_TURNS + 1);
    expect(msgs.at(-1)).toEqual({ role: "user", content: "q" });
  });

  it("drops empty turns and cuts long ones", () => {
    const msgs = buildMessages(
      [
        { role: "assistant", text: "" },
        { role: "user", text: "x".repeat(ASSISTANT_MAX_TEXT + 50) },
      ],
      "q",
    );
    expect(msgs).toHaveLength(2);
    expect((msgs[0].content as string).length).toBe(ASSISTANT_MAX_TEXT);
  });
});
