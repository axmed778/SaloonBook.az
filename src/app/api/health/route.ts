import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redisPing } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Health check, in two flavours:
 *
 *   GET /api/health          -> LIVENESS. Process-only, touches no dependency.
 *   GET /api/health?deep=1   -> READINESS. Also probes Postgres and Redis.
 *
 * The split exists because this route used to run `SELECT 1` on every hit. Any
 * uptime monitor pointed at it (or Railway's own healthcheck loop) therefore
 * issued a database query every interval, which on Neon WAKES THE COMPUTE: a
 * 60-second monitor means the compute never sits idle for the 5 uninterrupted
 * minutes Neon needs before it will autosuspend, so it bills CU-hours around
 * the clock for `SELECT 1`. Same story for Redis, at no benefit.
 *
 * A liveness probe is supposed to answer "is this process able to serve HTTP",
 * and the shallow response answers exactly that. Point uptime monitors and
 * Railway's `healthcheckPath` at the shallow form; use `?deep=1` by hand, or
 * from something that runs at most a few times an hour, when you actually want
 * to know whether the dependencies are reachable.
 *
 * `?deep=1` returns 503 when a dependency is down so a monitor can alert on the
 * status code rather than parsing the body. The shallow form is always 200 —
 * if the process were down there would be no response at all.
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

  const [db, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const).catch(() => "down" as const),
    redisPing().then((ok) => (ok ? ("ok" as const) : ("down" as const))),
  ]);

  const healthy = db === "ok" && redis === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: "deep",
      db,
      redis,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
