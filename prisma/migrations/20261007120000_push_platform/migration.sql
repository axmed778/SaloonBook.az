-- Which push service a PushSubscription row goes through.
--
-- "web" is the existing Web Push (VAPID) subscription. "ios" is an APNs device
-- token from the App Store app (Capacitor shell): endpoint holds
-- "apns:<hex token>" and p256dh/auth are empty strings. The worker
-- (worker/processors/push.ts) picks the sender by this column.
--
-- Additive only, and safe to re-run. Existing rows are all Web Push, which is
-- exactly the default.
--
-- Rollback: ALTER TABLE "PushSubscription" DROP COLUMN IF EXISTS "platform";

ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'web';
