// Same-origin guard for the auth endpoints.
//
// Without it a cross-site form POST can log a victim into the ATTACKER's
// account (login CSRF). Nothing looks broken to the victim, but every booking,
// client and payroll entry they create afterwards lands in the attacker's
// tenant, where he can simply read it back. The same trick against /register or
// /reset silently replaces the session under them.
//
// Session cookies are SameSite=Lax, which already blocks the classic
// cross-site POST in modern browsers. This is the second lock: it covers older
// browsers, non-browser clients replaying a stolen form, and any future cookie
// whose SameSite policy is relaxed.

import { NextRequest, NextResponse } from "next/server";

/** Parses a URL (or a bare origin) and returns its origin, or null if unusable. */
function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    // Covers the literal "null" Origin that sandboxed iframes and some
    // cross-scheme redirects send — not an origin of ours either way.
    return null;
  }
}

/**
 * The origins that count as "us". APP_URL is the canonical one, but a
 * deployment is usually reachable under a second hostname too (the Railway
 * subdomain next to the custom domain), and APP_URL names only one of them.
 *
 * Trusting the Host header here is safe: a cross-site attacker chooses the URL
 * the victim's browser posts to, but not the Origin the browser stamps on the
 * request, so "Origin equals the host we were reached on" still cannot be
 * forged from another site.
 */
function selfOrigins(req: NextRequest): Set<string> {
  const origins = new Set<string>();

  const appUrl = originOf(process.env.APP_URL?.trim());
  if (appUrl) origins.add(appUrl);

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      req.nextUrl.protocol.replace(/:$/, "") ||
      "https";
    const viaHost = originOf(`${proto}://${host}`);
    if (viaHost) origins.add(viaHost);
  }

  return origins;
}

function forbidden(): NextResponse {
  // Deliberately untranslated: a request that trips this never came from our
  // own UI, so there is no user reading the message.
  return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
}

/**
 * Returns a 403 response when a state-changing request did not come from our
 * own origin, or null when it may proceed. Call it as the FIRST thing in every
 * mutating handler under /api/auth:
 *
 *   const csrf = rejectCrossOrigin(req);
 *   if (csrf) return csrf;
 */
export function rejectCrossOrigin(req: NextRequest): NextResponse | null {
  const claimed =
    originOf(req.headers.get("origin")) ?? originOf(req.headers.get("referer"));

  if (!claimed) {
    // Browsers send Origin on every POST and Referer on almost all of them, so
    // neither header means either a stripped/forged request or a non-browser
    // client. In production that is not a case we serve; in development it is
    // usually curl, so we let it through to keep local work frictionless.
    return process.env.NODE_ENV === "production" ? forbidden() : null;
  }

  return selfOrigins(req).has(claimed) ? null : forbidden();
}
