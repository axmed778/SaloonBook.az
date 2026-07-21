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
  for (const [value, message] of warnings) {
    if (isPlaceholder(value)) console.warn(`[env] WARNING: ${message}`);
  }

  if (failures.length > 0) {
    throw new Error(
      "[env] Refusing to boot in production — required secrets missing or placeholder:\n" +
        failures.map((m) => `  - ${m}`).join("\n"),
    );
  }
}
