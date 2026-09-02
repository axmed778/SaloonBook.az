// Startup environment validation. Called once per server process: the web
// service from src/instrumentation.ts, the worker from worker/index.ts. In
// production we refuse to boot with placeholder or missing secrets; in
// development we only warn so local setup stays frictionless.
//
// The two services are SEPARATE Railway deployments with separate variable
// sets, and they need different secrets: only the web service serves the
// WhatsApp webhook and sends password-reset email, only the worker sends
// WhatsApp templates. Validating one service's list against the other would
// either demand secrets it has no use for or wave through the ones it does, so
// the required set is keyed by role.

const PLACEHOLDERS = new Set([
  "change-me-dev-verify-token",
  "change-me",
  "changeme",
  "",
]);

function isPlaceholder(v: string | undefined): boolean {
  return v === undefined || PLACEHOLDERS.has(v.trim());
}

/**
 * Warns when the Postgres connection strings are wired the wrong way round for
 * a scale-to-zero provider (Neon). Warn-only on purpose: a mis-pointed URL is a
 * COST and autosuspend problem, never a correctness or security one, and a
 * self-hosted/Railway Postgres legitimately has neither a pooled endpoint nor a
 * `-pooler` hostname — those deployments should see nothing here.
 *
 * What we want, and why:
 *   DATABASE_URL -> POOLED  ("-pooler" host) + `pgbouncer=true`
 *     Runtime queries. PgBouncer terminates the client connections, so the
 *     compute sees few, short-lived backend connections and can reach its
 *     5-minute autosuspend window. `pgbouncer=true` tells Prisma to stop using
 *     named prepared statements, which transaction-mode pooling cannot carry.
 *   DIRECT_URL   -> DIRECT  (no "-pooler")
 *     Migrations only. `prisma migrate` takes advisory locks and runs DDL that
 *     must stay on one real backend connection for the whole session.
 */
function checkDatabaseUrls(isWeb: boolean): void {
  const warn = (m: string) => console.warn(`[env] WARNING: ${m}`);

  const parse = (raw: string | undefined): URL | null => {
    if (!raw || raw.trim() === "") return null;
    try {
      return new URL(raw);
    } catch {
      return null;
    }
  };

  const runtime = parse(process.env.DATABASE_URL);
  const direct = parse(process.env.DIRECT_URL);

  // Only Neon has the pooled/direct split this check is about. Anything else
  // (local Postgres, Railway Postgres, embedded-pg) is left alone.
  const isNeon = (u: URL | null) => u !== null && u.hostname.endsWith(".neon.tech");
  if (!isNeon(runtime) && !isNeon(direct)) return;

  const pooled = (u: URL) => u.hostname.includes("-pooler");

  if (runtime && isNeon(runtime)) {
    if (!pooled(runtime)) {
      warn(
        "DATABASE_URL points at Neon's DIRECT endpoint (no '-pooler' in the hostname). " +
          "Every app/worker connection then lands on the compute itself, which keeps it " +
          "awake and burns CU-hours. Use the pooled endpoint for runtime queries and keep " +
          "the direct one in DIRECT_URL for migrations.",
      );
    } else if (runtime.searchParams.get("pgbouncer") !== "true") {
      warn(
        "DATABASE_URL uses Neon's pooled endpoint but is missing '?pgbouncer=true'. " +
          "Prisma will keep issuing named prepared statements, which PgBouncer's " +
          "transaction mode cannot carry — expect intermittent " +
          "'prepared statement \"s0\" already exists' errors under load.",
      );
    }
  }

  if (direct && isNeon(direct) && pooled(direct)) {
    warn(
      "DIRECT_URL points at Neon's POOLED endpoint ('-pooler' in the hostname). " +
        "Migrations need a direct connection — `prisma migrate deploy` can hang or fail " +
        "on its advisory lock through a transaction-mode pooler.",
    );
  }

  // Migrations run from the web service's preDeployCommand, never from the
  // worker, so a worker without DIRECT_URL is correct rather than misconfigured.
  if (isWeb && isNeon(runtime) && !direct) {
    warn(
      "DIRECT_URL is unset while DATABASE_URL is a Neon URL. `prisma migrate` " +
        "(schema.prisma's directUrl) has no unpooled connection to use.",
    );
  }
}

/** Which deployment is booting — they have different required variables. */
export type ServiceRole = "web" | "worker";

export function assertEnv(service: ServiceRole = "web"): void {
  const isProd = process.env.NODE_ENV === "production";
  const isWeb = service === "web";
  const isWorker = service === "worker";

  // CRITICAL secrets: a missing/placeholder value is a security hole, so in
  // production we refuse to boot rather than silently fall back. In dev we only
  // warn, so local setup stays frictionless.
  //
  // Keep this list to what the service ACTUALLY needs. Demanding a secret a
  // process never reads is not caution — it is a boot failure with a misleading
  // explanation, and it trains people to paste secrets into services that have
  // no business holding them.
  const critical: Array<[string | undefined, string]> = [];

  const whatsAppLive = !isPlaceholder(process.env.WHATSAPP_TOKEN);

  // --- Web service ---------------------------------------------------------
  if (isWeb) {
    // Signs and verifies the session cookies. Web-only: nothing in the worker's
    // import graph touches src/lib/auth/* — it moves queue jobs, not requests —
    // so requiring it there only produced a confusing crash.
    critical.push([
      process.env.SESSION_SECRET,
      "SESSION_SECRET is unset or a placeholder — session cookies would be signed " +
        "with the public dev fallback, letting anyone forge another user's session.",
    ]);

    // WHATSAPP_APP_SECRET is unconditionally critical, NOT conditional on
    // WHATSAPP_TOKEN. The token is a *worker* variable; the webhook route and
    // this check both live in the web service, so keying off it meant the web
    // service booted clean with an unauthenticated webhook — and that webhook
    // writes: an inbound "stop" clears waOptIn for every customer matching the
    // phone, across all salons.
    critical.push([
      process.env.WHATSAPP_APP_SECRET,
      "WHATSAPP_APP_SECRET is unset — the WhatsApp webhook cannot verify Meta's " +
        "signature, so anyone could post a forged 'stop' and mass-unsubscribe customers.",
    ]);

    // Transactional email (password reset). With the key unset src/lib/email.ts
    // runs in sandbox: the endpoint still answers 200, no mail is sent, and the
    // user waits for a reset link that will never arrive.
    critical.push([
      process.env.RESEND_API_KEY,
      "RESEND_API_KEY is unset — password-reset email would be silently dropped " +
        "while the endpoint still reports success.",
    ]);
    // The onboarding@resend.dev fallback only delivers to the Resend account
    // owner, so leaving it in place bounces every real customer's mail. Require
    // a verified sender explicitly rather than letting the default through.
    const from = process.env.EMAIL_FROM?.trim() ?? "";
    if (from === "" || /onboarding@resend\.dev/i.test(from)) {
      critical.push([
        undefined,
        `EMAIL_FROM is ${from === "" ? "unset" : `"${from}"`} — Resend only delivers ` +
          "from onboarding@resend.dev to the account owner, so mail to real users " +
          "bounces. Set a verified sender, e.g. SalonBook <no-reply@salonbook.az>.",
      ]);
    }

    // Turnstile is configured in two places that can drift: the secret is read
    // at runtime (src/lib/turnstile.ts), the site key is inlined at BUILD time
    // (NEXT_PUBLIC_*). Either half alone is a silent failure — secret only:
    // the widget never renders, no token is sent, every public booking 403s;
    // site key only: verifyTurnstile returns true unchecked, so there is no
    // CAPTCHA while the form still shows one. Demand both or neither.
    const tsSecret = !isPlaceholder(process.env.TURNSTILE_SECRET_KEY);
    const tsSite = !isPlaceholder(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
    if (tsSecret !== tsSite) {
      const half = tsSecret
        ? "TURNSTILE_SECRET_KEY is set but NEXT_PUBLIC_TURNSTILE_SITE_KEY is not, " +
          "so the widget never renders and every public booking is rejected with 403"
        : "NEXT_PUBLIC_TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET_KEY is not, " +
          "so tokens are never verified and the CAPTCHA is decorative";
      critical.push([
        undefined,
        `Turnstile is half-configured: ${half}. Set both or neither — and note that ` +
          "NEXT_PUBLIC_TURNSTILE_SITE_KEY is inlined at build time, so changing it " +
          "needs a rebuild, not just a restart.",
      ]);
    }

    // Instagram Direct is entirely optional — nothing warns when all of it is
    // absent. A HALF-configured one is the problem: /api/ig/webhook is routed
    // either way, so without IG_VERIFY_TOKEN Meta's handshake can never
    // succeed, and without IG_APP_SECRET the handler fails closed on every
    // delivery in production. Both look like "Instagram just doesn't work"
    // from the outside, with nothing in the logs to say which half is missing.
    //
    // Warn-only: an unset integration is a feature that is off, not a hole.
    // IG_APP_ID is listed because the app dashboard pairs it with the secret,
    // and a deployment missing it is one that was configured by half-copying.
    const igVars = [
      "IG_USER_ID",
      "IG_APP_ID",
      "IG_APP_SECRET",
      "IG_ACCESS_TOKEN",
      "IG_VERIFY_TOKEN",
    ] as const;
    const igMissing = igVars.filter((n) => isPlaceholder(process.env[n]));
    if (igMissing.length > 0 && igMissing.length < igVars.length) {
      console.warn(
        `[env] WARNING: Instagram Direct is half-configured — missing ${igMissing.join(", ")}. ` +
          "The /api/ig/webhook endpoint is live but will reject or drop deliveries. " +
          "Note IG_APP_SECRET is the INSTAGRAM app's secret, not WHATSAPP_APP_SECRET.",
      );
    }
  }

  // --- Worker service ------------------------------------------------------
  if (isWorker) {
    // Without these src/lib/whatsapp.ts returns {sandbox: true} and the
    // notification processor records SENT — nothing is delivered and every
    // dashboard reads clean. Refuse to boot instead.
    critical.push([
      process.env.WHATSAPP_TOKEN,
      "WHATSAPP_TOKEN is unset on the worker — notifications would be logged as " +
        "sandbox and still marked SENT, so nothing reaches customers and nothing looks wrong.",
    ]);
    critical.push([
      process.env.WHATSAPP_PHONE_NUMBER_ID,
      "WHATSAPP_PHONE_NUMBER_ID is unset on the worker — same silent-sandbox failure " +
        "as a missing WHATSAPP_TOKEN.",
    ]);
    // src/lib/redis.ts falls back to localhost, where the worker retries a
    // connection that will never come up while jobs pile in Redis it can't reach.
    critical.push([
      process.env.REDIS_URL,
      "REDIS_URL is unset on the worker — it would fall back to localhost and " +
        "process no jobs at all.",
    ]);
  }

  // WARN-only: degraded but not insecure.
  const warnings: Array<[string | undefined, string]> = [
    [
      process.env.WHATSAPP_VERIFY_TOKEN,
      "WHATSAPP_VERIFY_TOKEN is unset or still the placeholder.",
    ],
    ...(isWeb
      ? ([
          [
            process.env.WHATSAPP_TOKEN,
            "WHATSAPP_TOKEN is unset — the worker's notification sender will run in " +
              "sandbox (log-only) mode. Set it on the worker service, where it is required.",
          ],
        ] as Array<[string | undefined, string]>)
      : []),
    // Web Push (installable PWA notifications). Without VAPID keys the push
    // sender runs in sandbox (log-only) mode and the Settings toggle hides
    // itself — harmless until you want push, so warn-only.
    [
      process.env.VAPID_PUBLIC_KEY,
      "VAPID_PUBLIC_KEY is unset — Web Push runs in sandbox (log-only) mode; the notification toggle is hidden.",
    ],
    [
      process.env.VAPID_PRIVATE_KEY,
      "VAPID_PRIVATE_KEY is unset — Web Push cannot send.",
    ],
  ];

  // WHATSAPP_ENCRYPTION_KEY encrypts per-salon "own number" access tokens at rest
  // (src/lib/crypto.ts). Only needed once a salon is switched to its own number;
  // until then it's harmless to omit — warn-only, and the admin activation action
  // refuses cleanly if it's missing. Not a security hole when unset (no secret to
  // protect yet), so it never blocks boot.
  if (whatsAppLive) {
    warnings.push([
      process.env.WHATSAPP_ENCRYPTION_KEY,
      "WHATSAPP_ENCRYPTION_KEY is unset — per-salon 'own number' WhatsApp senders " +
        "cannot be activated (token encryption unavailable). Harmless until you use the feature.",
    ]);
  }

  const failures: string[] = [];
  for (const [value, message] of critical) {
    if (isPlaceholder(value)) {
      if (isProd) failures.push(message);
      else console.warn(`[env] WARNING: ${message}`);
    }
  }

  // APP_URL is baked into every link that leaves the server, and BOTH services
  // emit links — which is why the explanation names the ones that apply here
  // rather than a generic list. Unset, it falls back to http://localhost:3000,
  // which shipped localhost links to real users once, so in production it is
  // boot-critical. (localhost is fine in dev, hence no check there.)
  const appUrl = process.env.APP_URL?.trim() ?? "";
  if (isProd && (appUrl === "" || /localhost|127\.0\.0\.1/i.test(appUrl))) {
    const uses = isWeb
      ? "booking manage links, password-reset emails and the salon link in Settings"
      : "the dashboard link inside every Web Push notification (worker/processors/push.ts)";
    // The web service has a second, security-relevant use for it: the auth
    // routes treat APP_URL as their canonical origin when rejecting cross-site
    // POSTs, so the two reasons stay named in one place.
    const alsoAuth = isWeb
      ? " It is also the origin the auth routes accept POSTs from " +
        "(src/app/api/auth/_origin.ts) — unset, they fall back to the Host header alone."
      : "";
    failures.push(
      `APP_URL is ${appUrl === "" ? "unset" : `"${appUrl}"`} — ${uses} ` +
        "would point at localhost. Set it to the public origin, e.g. https://salonbook.az." +
        alsoAuth,
    );
  }
  // Client phone-OTP sign-in needs a delivery channel: WhatsApp (the platform
  // number) OR Twilio SMS. Without either, sign-in can't send codes in prod.
  const twilioConfigured =
    !isPlaceholder(process.env.TWILIO_ACCOUNT_SID) &&
    !isPlaceholder(process.env.TWILIO_AUTH_TOKEN) &&
    !isPlaceholder(process.env.TWILIO_FROM);
  if (isProd && !whatsAppLive && !twilioConfigured) {
    console.warn(
      "[env] WARNING: client phone-OTP sign-in has no delivery channel — set " +
        "WHATSAPP_TOKEN (WhatsApp) or TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM (SMS).",
    );
  }

  for (const [value, message] of warnings) {
    if (isPlaceholder(value)) console.warn(`[env] WARNING: ${message}`);
  }

  checkDatabaseUrls(isWeb);

  if (failures.length > 0) {
    throw new Error(
      "[env] Refusing to boot in production — required secrets missing or placeholder:\n" +
        failures.map((m) => `  - ${m}`).join("\n"),
    );
  }
}
