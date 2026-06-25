// Cloudflare Turnstile verification — the integration point for bot protection
// on the public booking form.
//
// INTEGRATION (frontend, when the booking form is built):
//   1. Render the Turnstile widget with site key NEXT_PUBLIC_TURNSTILE_SITE_KEY.
//   2. Send the resulting token in the POST /book body as `turnstileToken`.
//
// Server: if TURNSTILE_SECRET_KEY is set, the token is required and verified
// against Cloudflare. If it is NOT set (local dev / sandbox), verification is
// skipped so the flow stays usable without configuring Cloudflare.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Returns true when the request may proceed. When Turnstile is disabled (no
 * secret configured) this always returns true. When enabled, a missing or
 * invalid token returns false.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // disabled in dev/sandbox
  if (!token) return false;

  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error("[turnstile] verify error", e);
    // Fail closed: if we enabled Turnstile, a verification outage should not
    // become an open door.
    return false;
  }
}
