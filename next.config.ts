import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

// Content-Security-Policy. Kept compatible with Next (which injects inline
// bootstrap scripts/styles) and Cloudflare Turnstile.
//   - 'unsafe-inline' on script/style is a pragmatic relaxation; tightening to a
//     per-request nonce (via middleware) is a follow-up once middleware exists.
//   - frame-ancestors 'none' (plus X-Frame-Options) blocks clickjacking.
// Next.js dev (React Fast Refresh / webpack HMR) evaluates code via eval() and
// talks to the dev server over a websocket. A production-strict CSP without
// 'unsafe-eval' / ws: blocks that, so the page never hydrates and every client
// interaction (login, buttons) silently breaks — but only in `next dev`.
// Production builds don't use eval, so we keep the strict policy there.
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // OpenStreetMap raster tiles power the salon discovery map + location picker
  // (Leaflet). Tiles load as <img>, so the tile host must be allowed here.
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org",
  "font-src 'self' data:",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""} https://challenges.cloudflare.com`,
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // HSTS only takes effect over HTTPS; harmless on local http.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // geolocation=(self): the Settings location picker uses the device GPS
  // (navigator.geolocation) to let a salon drop a precise pin. Same-origin only.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep server-only packages out of the client bundle.
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Serwist compiles the service worker (src/app/sw.ts) to public/sw.js and injects
// the precache manifest + client registration. Disabled in dev so the SW never
// caches during `next dev` (which relies on eval/HMR the prod-strict CSP blocks).
// The generated public/sw.js is gitignored — it's a build artifact.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(withNextIntl(nextConfig));
