import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { accessRefusal } from "@/lib/auth/permissions";
import { recordGuideEvent } from "@/lib/guides/events";
import { rejectCrossOrigin } from "@/app/api/auth/_origin";

export const dynamic = "force-dynamic";

// Where the guides' analytics beacons land (navigator.sendBeacon in
// src/components/guides/guide-provider.tsx). A beacon is delivered even when
// the page changes or closes right after it is sent — "started" goes out the
// moment a guide opens, usually a click before a navigation, and as a server
// action it was cancelled by that navigation more often than not.
//
// The event is about the caller's OWN user row, never salon data, so the
// question is only "signed in to a salon with a working login": bookings.read,
// which every role that can sign in holds (permissions.test.ts), asked through
// accessRefusal like every dashboard route. Always answers 204 to a valid
// caller: a beacon cannot read a response, and there is nothing to tell it.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;
  const session = await getSession();
  if (!session?.salonId || accessRefusal(session, ["bookings.read"]) !== null) {
    return new NextResponse(null, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  await recordGuideEvent(session.user.id, body);
  return new NextResponse(null, { status: 204 });
}
