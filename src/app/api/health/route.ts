import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redisPing } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Railway's healthcheck points at this path (railway.json), and it treats any
// 2xx as healthy. So the status code IS the signal: returning a hardcoded 200
// meant a deploy with an unreachable database was promoted to serve traffic,
// every booking 500'd, and restartPolicyType: ON_FAILURE never fired because
// the process itself was alive. The body is for humans; the code is for Railway.
//
// Redis is deliberately NOT part of the verdict. Rate limiting fails open by
// design (src/lib/ratelimit.ts) and the queue is a worker concern, so a Redis
// blip degrades the site rather than breaking it — gating on it would roll back
// good deploys for a non-outage. It stays in the body for diagnosis.
export async function GET() {
  const [db, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const).catch(() => "down" as const),
    redisPing().then((ok) => (ok ? ("ok" as const) : ("down" as const))),
  ]);

  const healthy = db === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      db,
      redis,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
