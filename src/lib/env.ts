// Startup environment validation. Called from src/instrumentation.ts so it runs
// once per server process. In production we refuse to boot with placeholder or
// missing secrets; in development we only warn so local setup stays frictionless.

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
function checkDatabaseUrls(): void {
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

  if (isNeon(runtime) && !direct) {
    warn(
      "DIRECT_URL is unset while DATABASE_URL is a Neon URL. `prisma migrate` " +
        "(schema.prisma's directUrl) has no unpooled connection to use.",
    );
  }
}

export function assertEnv(): void {
  const isProd = process.env.NODE_ENV === "production";

  // CRITICAL secrets: a missing/placeholder value is a security hole, so in
  // production we refuse to boot rather than silently fall back. In dev we only
  // warn, so local setup stays frictionless.
  const critical: Array<[string | undefined, string]> = [
    [
      process.env.SESSION_SECRET,
      "SESSION_SECRET is unset or a placeholder — session cookies would be signed " +
        "with the public dev fallback, letting anyone forge another user's session.",
    ],
  ];

  // WHATSAPP_APP_SECRET only guards a real attack surface once the WhatsApp
  // integration is live (WHATSAPP_TOKEN set): the webhook skips signature
  // verification when it's absent, so an attacker could spoof delivery/status
  // callbacks. Until WhatsApp goes live there is no webhook traffic, so keep it
  // a warning; the moment WHATSAPP_TOKEN is set it becomes boot-critical.
  const whatsAppLive = !isPlaceholder(process.env.WHATSAPP_TOKEN);
  if (whatsAppLive) {
    critical.push([
      process.env.WHATSAPP_APP_SECRET,
      "WHATSAPP_APP_SECRET is unset while WhatsApp is live — incoming webhooks " +
        "cannot be signature-verified and could be spoofed.",
    ]);
  }

  // WARN-only: degraded but not insecure.
  const warnings: Array<[string | undefined, string]> = [
    [
      process.env.WHATSAPP_VERIFY_TOKEN,
      "WHATSAPP_VERIFY_TOKEN is unset or still the placeholder.",
    ],
    [
      process.env.WHATSAPP_TOKEN,
      "WHATSAPP_TOKEN is unset — notification sender will run in sandbox (log-only) mode.",
    ],
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
  if (!whatsAppLive) {
    warnings.push([
      process.env.WHATSAPP_APP_SECRET,
      "WHATSAPP_APP_SECRET is unset — WhatsApp webhooks can't be signature-verified " +
        "(harmless until WhatsApp goes live, then it becomes required).",
    ]);
  }

  const failures: string[] = [];
  for (const [value, message] of critical) {
    if (isPlaceholder(value)) {
      if (isProd) failures.push(message);
      else console.warn(`[env] WARNING: ${message}`);
    }
  }

  // APP_URL is baked into every link that leaves the server: the salon's
  // public link in Settings, the manage link on the booking success screen,
  // and password-reset emails. Unset it falls back to http://localhost:3000,
  // which shipped localhost links to real users once — so in production it is
  // boot-critical. (localhost is fine in dev, hence no warning there.)
  const appUrl = process.env.APP_URL?.trim() ?? "";
  if (isProd && (appUrl === "" || /localhost|127\.0\.0\.1/i.test(appUrl))) {
    failures.push(
      `APP_URL is ${appUrl === "" ? "unset" : `"${appUrl}"`} — customer-facing links ` +
        "(booking manage links, password-reset emails, the salon link in Settings) " +
        "would point at localhost. Set it to the public origin, e.g. https://salonbook.az",
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

  checkDatabaseUrls();

  if (failures.length > 0) {
    throw new Error(
      "[env] Refusing to boot in production — required secrets missing or placeholder:\n" +
        failures.map((m) => `  - ${m}`).join("\n"),
    );
  }
}
