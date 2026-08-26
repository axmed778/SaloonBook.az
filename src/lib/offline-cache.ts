// Client-side Cache Storage hygiene for logout.
//
// The service worker (src/app/sw.ts) now refuses to cache authenticated pages,
// but that only protects devices from the moment they pick up the new worker.
// Anything a device cached earlier stays on disk indefinitely — Cache Storage
// outlives the session cookie, and clearing the cookie does nothing to it. On a
// shared reception tablet that is exactly the leak: sign out, hand the device
// over, and the next person can still be served the previous session's
// dashboard from cache if the network stalls.
//
// So logout sweeps it. We delete matching ENTRIES rather than whole caches on
// purpose: dropping Serwist's precache would leave its bookkeeping pointing at
// assets that are no longer there. This only ever removes documents and RSC
// payloads for private paths, which the precache never contains.

/** Same private-path set the service worker refuses to cache. Keep in sync. */
const PRIVATE_PATH_RE = /^\/(?:az|en|ru)?\/?(?:dashboard|profile|a)(?:\/|$)/;

/** Best-effort: never throws, never blocks logout on failure. */
export async function purgeCachedPrivatePages(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        await Promise.all(
          keys.map(async (request) => {
            let pathname: string;
            try {
              pathname = new URL(request.url).pathname;
            } catch {
              return;
            }
            if (PRIVATE_PATH_RE.test(pathname)) await cache.delete(request);
          }),
        );
      }),
    );
  } catch (e) {
    console.warn("[offline-cache] purge failed", e);
  }
}
