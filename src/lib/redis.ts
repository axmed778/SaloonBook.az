import IORedis from "ioredis";

export const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires `maxRetriesPerRequest: null` on its connection.
//
// `lazyConnect: true` is important: route/page modules import the queue
// transitively, so without it ioredis opens a socket at *import* time — and
// `next build` (collecting page data) would try to reach Redis, which doesn't
// exist at build time. That flooded ECONNREFUSED and crashed the build. With
// lazyConnect the socket opens only on the first real command (enqueue / worker).
export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  // Railway's private network (*.railway.internal) is IPv6-only; family: 0 lets
  // Node's DNS return IPv6 so the internal Redis host resolves. Harmless
  // elsewhere.
  family: 0,
});

// Without an 'error' listener ioredis re-throws connection errors as unhandled,
// which can take down the process (or a Next build worker). Log and let BullMQ
// handle reconnection.
connection.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
