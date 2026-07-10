import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Locale routing only. Dashboard auth stays in dashboard/layout.tsx (Node
// runtime, node:crypto) — this middleware just resolves the locale and rewrites
// as-needed prefixes.
export default createMiddleware(routing);

export const config = {
  // Run on everything EXCEPT: API routes, Next internals, and any path with a
  // file extension (favicon, OG images, static assets). Keeps /api uncoupled
  // from locale handling.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
