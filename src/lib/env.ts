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
  const problems: string[] = [];
  const warnings: string[] = [];

  // Hard requirements in production.
  if (isPlaceholder(process.env.WHATSAPP_VERIFY_TOKEN)) {
    problems.push(
      "WHATSAPP_VERIFY_TOKEN is unset or still the placeholder. Set a strong, unique value.",
    );
  }

  // Auth must be configured in prod.
  if (isPlaceholder(process.env.CLERK_SECRET_KEY)) {
    problems.push("CLERK_SECRET_KEY is unset.");
  }
  if (isPlaceholder(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) {
    problems.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is unset.");
  }

  // Webhook signature verification needs the app secret once live.
  if (isPlaceholder(process.env.WHATSAPP_APP_SECRET)) {
    warnings.push(
      "WHATSAPP_APP_SECRET is unset — incoming WhatsApp webhooks cannot be signature-verified.",
    );
  }
  if (isPlaceholder(process.env.WHATSAPP_TOKEN)) {
    warnings.push(
      "WHATSAPP_TOKEN is unset — notification sender will run in sandbox (log-only) mode.",
    );
  }

  for (const w of warnings) console.warn(`[env] WARNING: ${w}`);

  if (isProd && problems.length > 0) {
    throw new Error(
      `[env] Refusing to start in production with insecure configuration:\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }

  if (!isProd && problems.length > 0) {
    for (const p of problems) console.warn(`[env] (dev) ${p}`);
  }
}
