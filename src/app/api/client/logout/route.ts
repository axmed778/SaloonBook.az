import { NextResponse } from "next/server";
import { clearClientSession } from "@/lib/auth/client-session";

export const dynamic = "force-dynamic";

// Sign the client out (clears the sb_client cookie). Owner sessions are separate.
export async function POST() {
  await clearClientSession();
  return NextResponse.json({ ok: true });
}
