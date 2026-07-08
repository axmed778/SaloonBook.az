-- Session cutoff for stateless cookies: sessions issued before this instant are
-- rejected. Bumped on password reset so a stolen session can't survive it.
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" TIMESTAMPTZ(6);
