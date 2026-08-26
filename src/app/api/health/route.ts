import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redisPing } from "@/lib/ratelimit";
import { readWorkerHeartbeat } from "@/lib/worker-heartbeat";

export const dynamic = "force-dynamic";

// Railway's healthcheck points at this path (railway.json), and it treats any
// 2xx as healthy. So the status code IS the signal: returning a hardcoded 200
// meant a deploy with an unreachable database was promoted to serve traffic,
// every booking 500'd, and restartPolicyType: ON_FAILURE never fired because
// the process itself was alive. The body is for humans; the code is for Railway.
//
// Redis and the worker are deliberately NOT part of the verdict. Rate limiting
// fails open by design (src/lib/ratelimit.ts) and the queue is a worker concern,
// so a Redis blip degrades the site rather than breaking it — gating on it would
// roll back good deploys for a non-outage. The worker is a different Railway
// service entirely: failing the WEB healthcheck because the WORKER is down would
// take the site off the air over something the site can still serve without.
// Both stay in the body, which is what an external monitor should alert on.
export async function GET() {
  const [db, redis, worker] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const).catch(() => "down" as const),
    redisPing().then((ok) => (ok ? ("ok" as const) : ("down" as const))),
    readWorkerHeartbeat(),
  ]);

  const healthy = db === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      db,
      redis,
      // "stale" = the worker stopped beating (notifications are silently not
      // sending). "unknown" = Redis didn't answer, so this says nothing about
      // the worker either way.
      worker: worker.state,
      workerAgeSec: worker.ageSec,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
