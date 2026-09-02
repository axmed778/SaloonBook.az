// One-off importer for Instagram Direct history.
//
// The webhook only ever sees messages that arrive AFTER the subscription was
// set up, so a salon that has been using Direct for months starts with an empty
// inbox. This walks /me/conversations and pulls the recent messages of each
// thread into the same tables the webhook writes.
//
// Run by hand, against whichever database DATABASE_URL points at:
//   npx tsx scripts/ig-backfill.ts
//   npx tsx scripts/ig-backfill.ts --depth=5        # 5 pages of messages/thread
//   npx tsx scripts/ig-backfill.ts --limit=25 --dry-run
//
// Safe to re-run and safe to run while the webhook is live: every write goes
// through recordIgMessage, which is keyed by Instagram's message id, so an
// overlap converges on the same rows instead of duplicating them.
//
// RATE LIMIT: Graph tolerates about 2 requests/second on one token, and blowing
// through that gets the token throttled for everyone — including the live
// webhook's profile lookups. Every request is preceded by a 600 ms pause, which
// keeps this under ~1.7 rps with no burst at all. Do not "optimise" it with
// Promise.all.

import { igSelfId, IG_GRAPH, graphError } from "../src/lib/instagram";
import { igAccessToken } from "../src/lib/ig-token";
import { recordIgMessage } from "../src/lib/ig-store";
import { GRAPH_TIMEOUT_MS } from "../src/lib/http";

/** Pause between every outgoing Graph call. See the rate-limit note above. */
const REQUEST_PAUSE_MS = 600;

/** Conversations per page. Meta caps this well above our default. */
const DEFAULT_PAGE_LIMIT = 50;

/** Messages fetched per thread page. */
const MESSAGE_PAGE_SIZE = 20;

/**
 * Hard stop on conversation pages. A runaway `paging.next` loop against a
 * rate-limited API is the one failure mode of a script like this that is worse
 * than importing nothing, so the walk is bounded rather than trusting the API
 * to terminate.
 */
const MAX_CONVERSATION_PAGES = 200;

interface Args {
  limit: number;
  depth: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const num = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    limit: num(get("limit"), DEFAULT_PAGE_LIMIT),
    depth: num(get("depth"), 1),
    dryRun: argv.includes("--dry-run"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One throttled Graph GET. `url` may be a full `paging.next` link, which
 * already carries its own access_token — in that case nothing is appended, so
 * the token never ends up in the URL twice.
 */
async function graphGet(url: string, token: string): Promise<Record<string, unknown>> {
  await sleep(REQUEST_PAUSE_MS);

  const u = new URL(url);
  if (!u.searchParams.has("access_token")) u.searchParams.set("access_token", token);

  const res = await fetch(u, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    // The URL is never printed: paging links carry the access token.
    throw new Error(`[ig:backfill] Graph ${res.status}: ${graphError(body)}`);
  }
  return (body ?? {}) as Record<string, unknown>;
}

interface Participant {
  id?: unknown;
  username?: unknown;
}

interface RawMessage {
  id?: unknown;
  from?: { id?: unknown };
  message?: unknown;
  created_time?: unknown;
}

/**
 * Meta returns `2026-08-30T12:34:56+0000` — ISO 8601 with a colon-less offset,
 * which is not what Date's spec-defined parser accepts. Node happens to cope,
 * other runtimes do not; normalising is one regex and removes the doubt.
 * Returns null rather than an Invalid Date so the caller can skip the row.
 */
function parseGraphTime(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw === "") return null;
  const d = new Date(raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** The other party in a conversation: the participant that is not us. */
function peerFromParticipants(conv: Record<string, unknown>, self: string): string | null {
  const data = asArray((conv.participants as { data?: unknown } | undefined)?.data);
  for (const p of data as Participant[]) {
    if (typeof p?.id === "string" && p.id !== self) return p.id;
  }
  return null;
}

interface Totals {
  threads: number;
  stored: number;
  skipped: number;
}

async function importConversation(
  convId: string,
  peer: string,
  token: string,
  args: Args,
  totals: Totals,
): Promise<void> {
  let url =
    `${IG_GRAPH}/${encodeURIComponent(convId)}` +
    `?fields=messages.limit(${MESSAGE_PAGE_SIZE}){id,from,message,created_time}`;
  const self = igSelfId() as string;

  for (let page = 0; page < args.depth && url; page++) {
    const body = await graphGet(url, token);

    // First page nests the edge under `messages`; a paging link returns the
    // edge itself, so accept either shape.
    const edge = (body.messages ?? body) as { data?: unknown; paging?: { next?: unknown } };

    for (const raw of asArray(edge?.data) as RawMessage[]) {
      const mid = raw?.id;
      const sentAt = parseGraphTime(raw?.created_time);
      const fromId = raw?.from?.id;
      // A message we cannot key or date is not importable. Skipping keeps the
      // run going rather than aborting a 200-thread import over one bad row.
      if (typeof mid !== "string" || mid === "" || !sentAt || typeof fromId !== "string") {
        totals.skipped++;
        continue;
      }

      if (args.dryRun) {
        totals.stored++;
        continue;
      }

      const { created } = await recordIgMessage({
        igUserId: peer,
        mid,
        fromMe: fromId === self,
        text: typeof raw.message === "string" ? raw.message : null,
        // The field set above does not request attachments, so history import
        // carries text only. The webhook fills `attach` for everything live.
        attach: null,
        sentAt,
      });
      if (created) totals.stored++;
    }

    const next = edge?.paging?.next;
    url = typeof next === "string" ? next : "";
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const self = igSelfId();
  if (!self) {
    // Without our own IGSID every message's direction is a guess, and a
    // backfill that mislabels who said what is worse than no backfill.
    console.error("IG_USER_ID is not set — cannot tell our messages from the lead's. Aborting.");
    process.exitCode = 1;
    return;
  }

  const token = await igAccessToken();
  if (!token) {
    console.error("No Instagram access token (IG_ACCESS_TOKEN unset and no stored token).");
    process.exitCode = 1;
    return;
  }

  console.log(
    `[ig:backfill] starting — ${args.limit} conversations/page, ` +
      `${args.depth} message page(s)/thread${args.dryRun ? ", DRY RUN" : ""}`,
  );

  const totals: Totals = { threads: 0, stored: 0, skipped: 0 };
  let url =
    `${IG_GRAPH}/me/conversations` +
    `?platform=instagram&fields=participants,updated_time&limit=${args.limit}`;

  for (let page = 0; page < MAX_CONVERSATION_PAGES && url; page++) {
    const body = await graphGet(url, token);

    for (const conv of asArray(body.data) as Record<string, unknown>[]) {
      const convId = conv?.id;
      if (typeof convId !== "string" || convId === "") continue;

      const peer = peerFromParticipants(conv, self);
      if (!peer) {
        // A conversation whose only participant is us (or whose participants
        // Graph withheld). Nothing to attribute the messages to.
        totals.skipped++;
        continue;
      }

      totals.threads++;
      try {
        await importConversation(convId, peer, token, args, totals);
      } catch (e) {
        // One unreadable thread must not end the run. Log the id, never the
        // contents, and move on.
        console.error(`[ig:backfill] thread ${convId} failed:`, (e as Error).message);
      }
    }

    const next = (body.paging as { next?: unknown } | undefined)?.next;
    url = typeof next === "string" ? next : "";
    if (url) console.log(`[ig:backfill] page ${page + 1} done (${totals.threads} threads so far)`);
  }

  console.log(
    `[ig:backfill] done — ${totals.threads} thread(s), ` +
      `${totals.stored} message(s) ${args.dryRun ? "would be imported" : "imported"}, ` +
      `${totals.skipped} skipped`,
  );
}

main()
  .catch((e) => {
    console.error("[ig:backfill] aborted:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => {
    // Prisma keeps a pool open; without this the script hangs after finishing.
    void import("../src/lib/prisma").then(({ prisma }) => prisma.$disconnect());
  });
