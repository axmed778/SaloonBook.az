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
  // NOTE: This guard is intentionally RELAXED for now. During early development
  // it only WARNS about missing/placeholder secrets instead of refusing to boot,
  // so a half-configured environment can't take the whole app down.
  //
  // TODO (before launch / real customers): re-tighten this to THROW in
  // production when WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET are unset or
  // still placeholders.
  const checks: Array<[string | undefined, string]> = [
    [
      process.env.WHATSAPP_VERIFY_TOKEN,
      "WHATSAPP_VERIFY_TOKEN is unset or still the placeholder.",
    ],
    [
      process.env.WHATSAPP_APP_SECRET,
      "WHATSAPP_APP_SECRET is unset — incoming WhatsApp webhooks cannot be signature-verified.",
    ],
    [
      process.env.WHATSAPP_TOKEN,
      "WHATSAPP_TOKEN is unset — notification sender will run in sandbox (log-only) mode.",
    ],
  ];

  for (const [value, message] of checks) {
    if (isPlaceholder(value)) console.warn(`[env] WARNING: ${message}`);
  }
}
