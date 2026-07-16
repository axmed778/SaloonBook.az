-- Who a booking is actually for. The Customer is keyed by phone (the contact),
-- so when one number books for several people (self, grandma, …) this holds the
-- attendee's name. Null falls back to the Customer's name.
ALTER TABLE "Appointment" ADD COLUMN "attendeeName" TEXT;
