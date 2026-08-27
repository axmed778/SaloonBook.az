import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";
import { rejectCrossOrigin } from "../_origin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Guarded like the other auth routes: forced logout is only a nuisance, but
  // it is still a cross-site write, and leaving one route open invites the next
  // one to be added without the check.
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  await clearSession();
  return NextResponse.json({ ok: true });
}
