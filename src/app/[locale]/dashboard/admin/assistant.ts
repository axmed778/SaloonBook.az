"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { bakuToday } from "@/lib/time";
import {
  ASSISTANT_MAX_STEPS,
  ASSISTANT_MAX_TOKENS,
  MODELS_WITH_FALLBACK,
  ASSISTANT_RATE_LIMIT,
  ASSISTANT_SYSTEM_PROMPT,
  ASSISTANT_TOOLS,
  askInputSchema,
  buildMessages,
  type Proposal,
} from "@/lib/admin-assistant/tools";
import { runAssistantTool } from "./assistant-tools";

// The admin assistant's one entry point. Runs only when the platform admin asks
// a question — there is no schedule and no background job. Read tools run here;
// changes come back as proposals the admin confirms in the browser, which then
// calls the ordinary admin actions (see src/lib/admin-assistant/tools.ts).

export type AskResult =
  | { ok: true; answer: string; proposals: Proposal[] }
  | { ok: false; error: string };

/** The acting platform admin's user id, or null for anyone else. */
async function requireAdmin(): Promise<string | null> {
  const session = await getSession();
  return session?.isAdmin ? session.user.id : null;
}

export async function askAssistant(input: unknown): Promise<AskResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.assistant.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };

  const parsed = askInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalid") };
  if (!process.env.ANTHROPIC_API_KEY?.trim())
    return { ok: false, error: t("noKey") };

  const rl = await rateLimit(
    `admin:assistant:${adminId}`,
    ASSISTANT_RATE_LIMIT.limit,
    ASSISTANT_RATE_LIMIT.windowSec,
  );
  if (!rl.allowed) return { ok: false, error: t("rateLimited") };

  const client = new Anthropic();
  const messages = buildMessages(parsed.data.history, parsed.data.question);
  const proposals: Proposal[] = [];
  const model = parsed.data.model;

  try {
    for (let step = 0; step < ASSISTANT_MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model,
        max_tokens: ASSISTANT_MAX_TOKENS,
        output_config: { effort: "medium" },
        // A policy decline on the main model is retried on a fallback model in
        // the same call, instead of leaving the admin with no answer.
        ...(MODELS_WITH_FALLBACK.has(model)
          ? {
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default" as const,
            }
          : {}),
        tools: ASSISTANT_TOOLS,
        system: [
          {
            type: "text",
            text: ASSISTANT_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: `Today in Baku: ${bakuToday()}.` },
        ],
        messages,
      });

      if (res.stop_reason === "refusal")
        return { ok: false, error: t("refused") };
      messages.push({ role: "assistant", content: res.content });

      const calls = res.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      if (res.stop_reason !== "tool_use" || calls.length === 0) {
        const answer = res.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { ok: true, answer, proposals };
      }

      // Every tool_use gets its result in ONE user message, failures included.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        try {
          const out = await runAssistantTool(call.name, call.input);
          if (out.kind === "proposal") proposals.push(out.proposal);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: out.content,
            ...(out.kind === "result" && out.isError ? { is_error: true } : {}),
          });
        } catch (e) {
          console.error(`[admin-assistant] tool ${call.name} failed`, e);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content:
              "The lookup failed on the server. Tell the admin it could not be checked.",
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }
    // Out of steps: return what was proposed so far rather than nothing.
    return { ok: true, answer: t("tooManySteps"), proposals };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError)
      return { ok: false, error: t("busy") };
    if (e instanceof Anthropic.APIError) {
      console.error(`[admin-assistant] API error ${e.status}`, e.message);
      return { ok: false, error: t("failed") };
    }
    console.error("[admin-assistant] failed", e);
    return { ok: false, error: t("failed") };
  }
}
