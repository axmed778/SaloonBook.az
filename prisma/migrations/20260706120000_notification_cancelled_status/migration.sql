-- Notifications for appointments that get cancelled (or marked no-show) before
-- the send fires are marked CANCELLED instead of being sent.
ALTER TYPE "NotifStatus" ADD VALUE 'CANCELLED';
