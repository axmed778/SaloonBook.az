import IORedis from "ioredis";

export const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires `maxRetriesPerRequest: null` on its connection.
export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
