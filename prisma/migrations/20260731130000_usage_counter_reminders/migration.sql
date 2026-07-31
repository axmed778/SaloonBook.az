-- Per-month WhatsApp reminder counter, for plan quota enforcement
-- (plans.ts maxRemindersPerMonth; enforced in worker/processors/notifications.ts).
ALTER TABLE "UsageCounter" ADD COLUMN "reminders" INTEGER NOT NULL DEFAULT 0;
