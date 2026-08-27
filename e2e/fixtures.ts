import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * What the smoke suite assumes about the database behind $DATABASE_URL.
 *
 * `pnpm db:seed` creates the "demostudio" salon (ACTIVE, two employees, two
 * services, Mon–Sat working hours) — that is the fixture these specs read. A
 * deployment with a different demo salon can point them elsewhere without
 * touching the specs.
 */
export const salon = {
  slug: process.env.E2E_SALON_SLUG ?? "demostudio",
  name: process.env.E2E_SALON_NAME ?? "Demo Beauty Studio",
};

/**
 * Credentials that must NOT authenticate. A random local part keeps the
 * per-email rate limit (10 attempts / 300s) from accumulating across runs, so
 * repeated CI runs against one server still get a 401 rather than a 429.
 */
export function badCredentials() {
  return {
    email: `e2e-no-such-user-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    password: "definitely-not-the-password",
  };
}

type Catalog = {
  Booking: { eyebrow: string };
  Auth: { login: { title: string; submit: string } };
};

// Read rather than `import … from "…json"`: this package is ESM
// ("type": "module"), where a JSON specifier needs an import attribute that
// Playwright's loader and `tsc --noEmit` do not agree on. A plain read has no
// such edge and costs one file open per worker.
const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/az.json", import.meta.url)), "utf8"),
) as Catalog;

// UI copy comes from the AZ catalog rather than being hardcoded here: the specs
// browse with locale az-AZ (the un-prefixed default — see src/i18n/routing.ts),
// so sourcing the strings means a copy edit in messages/az.json cannot break the
// suite, while a genuinely missing element still does.
export const copy = {
  bookingEyebrow: catalog.Booking.eyebrow,
  loginTitle: catalog.Auth.login.title,
  loginSubmit: catalog.Auth.login.submit,
};
