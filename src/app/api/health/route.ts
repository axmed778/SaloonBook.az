import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redisPing } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET() {
  const [db, redis] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const).catch(() => "down" as const),
    redisPing().then((ok) => (ok ? ("ok" as const) : ("down" as const))),
  ]);

  return NextResponse.json({
    status: "ok",
    db,
    redis,
    time: new Date().toISOString(),
  });
}
