import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redisPing } from "@/lib/ratelimit";
import { readWorkerHeartbeat } from "@/lib/worker-heartbeat";

export const dynamic = "force-dynamic";

/**
 * Health check, in two flavours:
 *
 *   GET /api/health          -> LIVENESS. Process-only, touches no dependency.
 *   GET /api/health?deep=1   -> READINESS. Also probes Postgres, Redis and the
 *                               worker's heartbeat.
 *
 * The split exists because this route used to run `SELECT 1` on every hit. Any
 * uptime monitor pointed at it therefore issued a database query every interval,
 * which on Neon WAKES THE COMPUTE: a 60-second monitor means the compute never
 * sits idle for the 5 uninterrupted minutes Neon needs before it will
 * autosuspend, so it bills CU-hours around the clock for `SELECT 1`.
 *
 * A liveness probe is supposed to answer "is this process able to serve HTTP",
 * and the shallow response answers exactly that. Point uptime monitors at the
 * shallow form and check the deep one on a slow cadence (hourly is plenty).
 *
 * Railway's `healthcheckPath` points at the DEEP form (railway.json), which is
 * the one thing that must not be shallow. Its job is to decide whether a new
 * deployment may take traffic, and a check that cannot fail cannot do that job:
 * with a shallow probe, a deploy whose database is unreachable is promoted,
 * every booking 500s, and restartPolicyType: ON_FAILURE never fires because the
 * process is alive. Healthchecks run while a deployment starts, not on a loop
 * forever, so this costs a handful of queries per deploy rather than a permanent
 * wake-up signal.
 *
 * Only the DATABASE decides the status code. Redis and the worker are reported
 * but never gate it:
 *   - Rate limiting fails open by design (src/lib/ratelimit.ts) and enqueueing
 *     is time-bounded and best-effort, so the site serves without Redis. Gating
 *     on it would roll back a good deploy for a non-outage.
 *   - The worker is a different Railway service entirely. Failing the WEB
 *     healthcheck because the WORKER is down would take the site off the air
 *     over something the site can still serve without.
 * A monitor that wants to alert on those should read the body.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const deep = new URL(request.url).searchParams.get("deep");
  const wantDeep = deep === "1" || deep === "true";

  if (!wantDeep) {
    return NextResponse.json(
      { status: "ok", checks: "shallow", time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [db, redis, worker] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const).catch(() => "down" as const),
    redisPing().then((ok) => (ok ? ("ok" as const) : ("down" as const))),
    readWorkerHeartbeat(),
  ]);

  const healthy = db === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: "deep",
      db,
      redis,
      // "stale" = the worker stopped beating, so notifications are silently not
      // sending. "unknown" = Redis didn't answer, so this says nothing about the
      // worker either way.
      worker: worker.state,
      workerAgeSec: worker.ageSec,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
