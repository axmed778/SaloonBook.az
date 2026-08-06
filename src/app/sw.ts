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
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected by Serwist at build time — the list of precached shell assets.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Order matters: these rules are placed BEFORE defaultCache so they win over
// its generic handlers.
const runtimeRules: RuntimeCaching[] = [
  {
    // OpenStreetMap raster tiles (the Leaflet basemap on the discovery map and
    // the Settings location picker). These are cross-origin <img> requests, so
    // WITHOUT this rule they fall through to defaultCache's catch-all
    // "cross-origin" NetworkFirst handler. That handler mishandles the opaque
    // (no-cors) tile responses and serves a 503, so every tile fails and the map
    // renders as a blank grey grid — but only in production, where the service
    // worker is active (it's disabled in `next dev`, which is why the map works
    // locally and broke on the live site). CacheFirst with an explicit
    // cacheable-status list that includes 0 (opaque) both fixes loading and
    // caches tiles, so we stop re-hitting OSM on every view — their tile usage
    // policy expects caching, not per-request fetching.
    matcher: ({ url }) =>
      url.hostname === "tile.openstreetmap.org" ||
      url.hostname.endsWith(".tile.openstreetmap.org"),
    handler: new CacheFirst({
      cacheName: "osm-tiles",
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({
          maxEntries: 256,
          maxAgeSeconds: 7 * 24 * 60 * 60, // a week — basemaps change rarely
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
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
  runtimeCaching: [...runtimeRules, ...defaultCache],
});

serwist.addEventListeners();

// --- Web Push -------------------------------------------------------------
// Render the notification the BullMQ push worker sent (see worker/processors/
// push.ts -> src/lib/push.ts), and focus/open the dashboard when it's tapped.
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data: PushPayload = {};
  try {
    data = event.data.json() as PushPayload;
  } catch {
    data = { body: event.data.text() };
  }
  const title = data.title || "SalonBook";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing app window (and navigate it) rather than opening a new one.
      for (const client of clients) {
        if ("focus" in client) {
          void client.focus();
          if ("navigate" in client) void client.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target).then(() => undefined);
    }),
  );
});
