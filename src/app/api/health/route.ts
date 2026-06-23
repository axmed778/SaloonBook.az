import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  let db: "ok" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "ok";
  } catch {
    db = "down";
  }

  return NextResponse.json({
    status: "ok",
    db,
    time: new Date().toISOString(),
  });
}
