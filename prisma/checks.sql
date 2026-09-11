-- SalonBook.az — CHECK constraints: the database's own floor under Zod.
-- Apply AFTER `prisma migrate` on every environment:  pnpm db:checks
--
-- Money is stored as integer qəpik (never floats) and every write path validates
-- it at the edge with Zod. That covers the HTTP surface only: a server action
-- refactor, a worker, a script, a psql session or a hand-written UPDATE all reach
-- the tables directly. Payroll reads these numbers back and pays people with
-- them, so one negative payout or a 500% commission is real money going wrong.
-- These constraints make that physically impossible, not merely unlikely.
--
-- Rules of this file:
--   * Idempotent AND non-destructive — every constraint is ADDed only when
--     absent, exactly like prisma/constraints.sql. Never DROP-then-ADD: this
--     file runs from preDeployCommand, apply-sql.ts runs each statement in its
--     own implicit transaction, so a DROP would commit and leave a window with
--     no protection at all (and a permanently unprotected table if the re-ADD
--     then failed).
--   * Only bounds that are already true of every existing row. A CHECK that
--     fails on production data does not protect anything — it breaks the deploy.
--     Bounds here mirror the Zod schemas that have guarded these columns since
--     they existed, with the floor kept at or below the app's own floor (e.g.
--     Payout is `>= 1` in Zod, `>= 0` here) so the database never rejects a
--     value the application considers legal.
--   * One DO block per table: the ACCESS EXCLUSIVE lock and the validating scan
--     are per-table and released between statements. After the first successful
--     run every block is a no-op that takes no lock at all.
--
-- Deliberately NOT constrained (see the report / git history for the reasoning):
--   * Review."rating" — already has Review_rating_check from its migration.
--   * ServiceAddon / AppointmentAddon price and minutes — created with their
--     CHECKs in migration 20260911120000_service_addons.
--   * Invite."usedCount" <= "maxUses" — an admin lowering maxUses on a partly
--     redeemed invite is legitimate; only the negative side is nonsense.
--   * Upper bounds on money — Zod caps them per surface; a hard ceiling in the
--     database would reject a legitimately large salon's numbers later.

-- Payroll inputs. commissionPct is a whole percent of the employee's COMPLETED
-- revenue: outside 0..100 it silently pays out more than the salon earned.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_base_salary_nonneg'
  ) THEN
    ALTER TABLE "Employee"
      ADD CONSTRAINT employee_base_salary_nonneg CHECK ("baseSalaryMinor" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_commission_pct_range'
  ) THEN
    ALTER TABLE "Employee"
      ADD CONSTRAINT employee_commission_pct_range
      CHECK ("commissionPct" BETWEEN 0 AND 100);
  END IF;
END $$;

-- Money actually handed to an employee. There is no refund/correction path in
-- the product (payouts are only ever added), so a negative row is always a bug.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payout_amount_nonneg'
  ) THEN
    ALTER TABLE "Payout"
      ADD CONSTRAINT payout_amount_nonneg CHECK ("amountMinor" >= 0);
  END IF;
END $$;

-- Catalog. A zero-price service is legal (consultations); a zero-duration one
-- is not — it would produce an appointment that starts and ends at once and
-- slips straight through the no-overlap exclusion constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_price_nonneg'
  ) THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT service_price_nonneg CHECK ("priceMinor" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_duration_positive'
  ) THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT service_duration_positive CHECK ("durationMin" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_buffer_nonneg'
  ) THEN
    ALTER TABLE "Service"
      ADD CONSTRAINT service_buffer_nonneg CHECK ("bufferMin" >= 0);
  END IF;
END $$;

-- Bookings. priceMinor is the snapshot payroll and the ROI dashboard sum over,
-- so it carries the same floor as the catalog price it was copied from.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_price_nonneg'
  ) THEN
    ALTER TABLE "Appointment"
      ADD CONSTRAINT appointment_price_nonneg CHECK ("priceMinor" >= 0);
  END IF;

  -- endsAt is always startsAt + durationMin + bufferMin. An inverted or empty
  -- range would also defeat appointment_no_overlap, whose GiST range is built
  -- from these two columns.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_ends_after_starts'
  ) THEN
    ALTER TABLE "Appointment"
      ADD CONSTRAINT appointment_ends_after_starts CHECK ("endsAt" > "startsAt");
  END IF;
END $$;

-- Weekly availability, in Baku-local minutes from midnight. 1440 = end of day.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workinghour_weekday_range'
  ) THEN
    ALTER TABLE "WorkingHour"
      ADD CONSTRAINT workinghour_weekday_range CHECK ("weekday" BETWEEN 0 AND 6);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workinghour_minutes_range'
  ) THEN
    ALTER TABLE "WorkingHour"
      ADD CONSTRAINT workinghour_minutes_range
      CHECK ("startMin" >= 0 AND "endMin" <= 1440 AND "endMin" > "startMin");
  END IF;
END $$;

-- One-off blocks. An inverted range would silently block nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'timeoff_ends_after_starts'
  ) THEN
    ALTER TABLE "TimeOff"
      ADD CONSTRAINT timeoff_ends_after_starts CHECK ("endsAt" > "startsAt");
  END IF;
END $$;

-- Denormalized visit counter, incremented only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_total_visits_nonneg'
  ) THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT customer_total_visits_nonneg CHECK ("totalVisits" >= 0);
  END IF;
END $$;

-- Delivery retry counter.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_attempts_nonneg'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT notification_attempts_nonneg CHECK ("attempts" >= 0);
  END IF;
END $$;

-- Salon: the review aggregate and the map pin.
DO $$
BEGIN
  -- ratingSum only ever grows by a Review.rating of 1..5, so the average it
  -- feeds (ratingSum / ratingCount) must stay inside 1..5. Anything else means
  -- the aggregate drifted from the Review rows and the discovery min-rating
  -- filter is lying.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_rating_aggregate_sane'
  ) THEN
    ALTER TABLE "Salon"
      ADD CONSTRAINT salon_rating_aggregate_sane
      CHECK (
        "ratingCount" >= 0
        AND "ratingSum" >= "ratingCount"
        AND "ratingSum" <= "ratingCount" * 5
      );
  END IF;

  -- WGS84 degrees. A lone coordinate is meaningless: the salon would either
  -- vanish from the map or be placed on the equator.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_location_valid'
  ) THEN
    ALTER TABLE "Salon"
      ADD CONSTRAINT salon_location_valid
      CHECK (
        ("latitude" IS NULL) = ("longitude" IS NULL)
        AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
        AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
      );
  END IF;
END $$;

-- Billing. extraBranches is a paid entitlement: a negative value would subtract
-- from the plan's included branches and lock an owner out of their own salons.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_extra_branches_nonneg'
  ) THEN
    ALTER TABLE "Subscription"
      ADD CONSTRAINT subscription_extra_branches_nonneg CHECK ("extraBranches" >= 0);
  END IF;
END $$;

-- Recorded payments (manual billing MVP). periodMonths multiplies into
-- currentPeriodEnd, so zero or negative would end the paid period in the past.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_amount_nonneg'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT payment_amount_nonneg CHECK ("amountMinor" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_period_months_positive'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT payment_period_months_positive CHECK ("periodMonths" > 0);
  END IF;
END $$;

-- Monthly booking quota counter. releaseBookingQuota() guards the decrement
-- with `bookings > 0`; this makes the underflow impossible rather than avoided.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'usagecounter_bookings_nonneg'
  ) THEN
    ALTER TABLE "UsageCounter"
      ADD CONSTRAINT usagecounter_bookings_nonneg CHECK ("bookings" >= 0);
  END IF;
END $$;

-- Invite redemption counters (hand-created by platform admins).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invite_counters_nonneg'
  ) THEN
    ALTER TABLE "Invite"
      ADD CONSTRAINT invite_counters_nonneg
      CHECK ("maxUses" >= 0 AND "usedCount" >= 0);
  END IF;
END $$;
