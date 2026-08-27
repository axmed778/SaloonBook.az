-- Every remaining bare `timestamp(3)` column becomes `timestamptz(3)`.
--
-- Prisma maps DateTime to `timestamp WITHOUT time zone` by default. The app has
-- only ever been correct because the Neon session happens to run with TimeZone
-- = UTC: a session in any other zone would make Postgres interpret those stored
-- wall-clock values as local, silently shifting appointment and consent times.
-- The instant columns (startsAt/endsAt/consentAt/...) were already timestamptz;
-- this converts the 19 that were not, Account.legalAcceptedAt among them.
--
-- The USING clause is the load-bearing part: existing values were written as UTC
-- wall-clock, so they must be reinterpreted AT TIME ZONE 'UTC' rather than let
-- Postgres assume the server's local zone.
--
-- Compatible with the GiST no-overlap constraint in prisma/constraints.sql: it
-- builds tstzrange("startsAt", "endsAt"), and those two columns were already
-- timestamptz — nothing here touches them.
--
-- Every statement is guarded so `prisma migrate deploy` can be re-run against a
-- database where some (or all) of the columns have already been converted.


DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Account'
      AND column_name = 'legalAcceptedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Account"
      ALTER COLUMN "legalAcceptedAt" TYPE timestamptz(3)
      USING "legalAcceptedAt" AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Account'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Account"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Appointment'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Appointment"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Client'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Client"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Customer'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Customer"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'CustomerNote'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "CustomerNote"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Employee'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Employee"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Invite'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Invite"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Notification'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Notification"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'PasswordResetToken'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "PasswordResetToken"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'PushSubscription'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "PushSubscription"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Review'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Review"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Salon'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Salon"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Service'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Service"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Subscription'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Subscription"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Subscription'
      AND column_name = 'updatedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "Subscription"
      ALTER COLUMN "updatedAt" TYPE timestamptz(3)
      USING "updatedAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "User"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'WhatsAppSender'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "WhatsAppSender"
      ALTER COLUMN "createdAt" TYPE timestamptz(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'WhatsAppSender'
      AND column_name = 'updatedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "WhatsAppSender"
      ALTER COLUMN "updatedAt" TYPE timestamptz(3)
      USING "updatedAt" AT TIME ZONE 'UTC';
  END IF;
END $$;
