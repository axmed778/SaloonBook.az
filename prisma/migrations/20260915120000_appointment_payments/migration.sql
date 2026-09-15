-- Payments on bookings (finance phase 2).
--
-- Additive only, and safe to re-run: the two enums are created inside a DO block
-- that swallows duplicate_object, and every other statement carries IF NOT
-- EXISTS. Applied twice to a local database to check.
--
-- NOTE ON NAMES. "AppointmentPayment", not "Payment": the latter is SaaS
-- subscription billing and has nothing to do with a salon's till.
--
-- Rollback (the CHECKs and FKs go with the table):
--   DROP TABLE IF EXISTS "AppointmentPayment";
--   DROP TYPE IF EXISTS "PaymentKind";
--   DROP TYPE IF EXISTS "PaymentMethod";
--   Nothing else references either, so the code can be rolled back first or
--   second. Money rows are business records: take a dump before dropping.

DO $$ BEGIN
  CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TERMINAL', 'TRANSFER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AppointmentPayment" (
  "id"               TEXT NOT NULL,
  "salonId"          TEXT NOT NULL,
  "appointmentId"    TEXT NOT NULL,
  "kind"             "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
  "method"           "PaymentMethod" NOT NULL,
  -- Money in whole qəpik, like every other amount in the schema.
  --   amount   >= 0: a fully comped booking is amount 0 with discount = price.
  --   discount >= 0, tip >= 0.
  -- An entry must still move something, or it is a row that says nothing:
  -- amount + discount > 0. A tip-only row would be a payment of nothing, so the
  -- tip does not count toward that floor.
  "amountMinor"      INTEGER NOT NULL,
  "discountMinor"    INTEGER NOT NULL DEFAULT 0,
  "tipMinor"         INTEGER NOT NULL DEFAULT 0,
  -- Baku day of paidAt, "YYYY-MM-DD". The PAYMENT day (the shift key in phase
  -- 3); revenue and payouts follow the BOOKING day instead (D7).
  "businessDate"     TEXT NOT NULL,
  "paidAt"           TIMESTAMPTZ(6) NOT NULL,
  -- User-id scalars with a name snapshot and NO foreign key: revoking a
  -- master's login deletes their User row, and an FK would make revoke fail.
  "receivedByUserId" TEXT,
  "receivedByName"   TEXT,
  "note"             TEXT,
  "createdByUserId"  TEXT NOT NULL,
  -- "Deleting" a payment voids it; the row stays, with who, when and why.
  "voidedAt"         TIMESTAMPTZ(6),
  "voidedByUserId"   TEXT,
  "voidReason"       TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentPayment_pkey" PRIMARY KEY ("id")
);

-- The CHECKs are added separately, NOT inside CREATE TABLE IF NOT EXISTS: on a
-- database where the table already exists that statement is a no-op and every
-- constraint inside it would silently never be created. Each ADD is its own
-- self-healing block, so a re-run over a half-built table finishes the job.
DO $$ BEGIN
  ALTER TABLE "AppointmentPayment"
    ADD CONSTRAINT "AppointmentPayment_amount_nonneg" CHECK ("amountMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AppointmentPayment"
    ADD CONSTRAINT "AppointmentPayment_discount_nonneg" CHECK ("discountMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AppointmentPayment"
    ADD CONSTRAINT "AppointmentPayment_tip_nonneg" CHECK ("tipMinor" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An entry must move something: a fully comped booking is amount 0 with the
-- discount carrying the price, and a tip alone is not a payment.
DO $$ BEGIN
  ALTER TABLE "AppointmentPayment"
    ADD CONSTRAINT "AppointmentPayment_moves_something"
    CHECK ("amountMinor" + "discountMinor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A refund is money going back out: it carries no discount and no tip.
DO $$ BEGIN
  ALTER TABLE "AppointmentPayment"
    ADD CONSTRAINT "AppointmentPayment_refund_is_plain"
    CHECK ("kind" <> 'REFUND' OR ("discountMinor" = 0 AND "tipMinor" = 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A void is all-or-nothing: who and when travel together.
DO $$ BEGIN
  ALTER TABLE "AppointmentPayment"
    ADD CONSTRAINT "AppointmentPayment_void_complete"
    CHECK (("voidedAt" IS NULL) = ("voidedByUserId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Restrict, not Cascade: a booking carrying money is a business record, and
-- deleteCustomer already refuses to hard-delete over one.
DO $$ BEGIN
  ALTER TABLE "AppointmentPayment"
    ADD CONSTRAINT "AppointmentPayment_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AppointmentPayment"
    ADD CONSTRAINT "AppointmentPayment_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The shift/day query in phase 3, and the per-booking read on every popup.
CREATE INDEX IF NOT EXISTS "AppointmentPayment_salonId_businessDate_idx"
  ON "AppointmentPayment" ("salonId", "businessDate");
CREATE INDEX IF NOT EXISTS "AppointmentPayment_appointmentId_idx"
  ON "AppointmentPayment" ("appointmentId");
