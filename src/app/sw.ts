/// <reference lib="webworker" />
//
// SalonBook service worker (compiled by @serwist/next -> public/sw.js).
//
// Caching policy:
//   * Precache the app shell (build assets, injected as self.__SW_MANIFEST).
//   * StaleWhileRevalidate for static assets (js/css/img/fonts) — from defaultCache.
//   * NetworkFirst for pages (the shell) and the PUBLIC read API — from the rules
//     below + defaultCache.
//   * NEVER cache authenticated API responses: everything under /api/ that isn't
//     an explicitly-public feed is NetworkOnly, so a session-scoped or foreign
//     response can never be served from cache.
//
// This file is intentionally excluded from the main tsconfig (DOM vs WebWorker
// lib conflict) and type-checked via tsconfig.sw.json instead.
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected by Serwist at build time — the list of precached shell assets.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Order matters: these /api rules are placed BEFORE defaultCache so they win over
// its generic API handler, which would otherwise cache authenticated GETs.
const apiCaching: RuntimeCaching[] = [
  {
    // Public, unauthenticated read feeds (e.g. the salon discovery map). Safe to
    // cache network-first so the map still paints when briefly offline.
    matcher: ({ url, sameOrigin, request }) =>
      sameOrigin && request.method === "GET" && url.pathname.startsWith("/api/public/"),
    handler: new NetworkFirst({
      cacheName: "sb-public-api",
      networkTimeoutSeconds: 10,
    }),
  },
  {
    // Everything else under /api/* — dashboard exports, push subscribe, auth,
    // webhooks — is authenticated and/or a mutation. Never cache it.
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...apiCaching, ...defaultCache],
});

serwist.addEventListeners();
