-- Where people get stuck in the interactive guides (src/lib/guides/registry.ts).
--
-- Read-only. Run in the Neon SQL Editor (or psql) against production; nothing
-- here writes. GuideEvent is per user, with no salon data: see the model in
-- prisma/schema.prisma.
--
-- Events:
--   started    step 0, when a guide is opened
--   completed  the last step reached
--   abandoned  with the step it happened on and a reason:
--                exit       the person closed it (Exit, the X, Escape)
--                not_found  the step's element never appeared (4 s): a broken
--                           or moved data-tour anchor, or a screen the person
--                           could not reach — look at these first
--                timeout    left mid-guide and not back within an hour
--                           (reported when they next open the dashboard)
--
-- Change the interval in `params` to look at another period.
--
-- The `steps` table names each step. registry.test.ts fails when it drifts
-- from the registry, so it is safe to trust.

-- 1. Per guide: how many start, how many finish.
WITH params AS (SELECT now() - interval '30 days' AS since)
SELECT
  "guideId"                                                     AS guide,
  count(*) FILTER (WHERE event = 'started')                     AS started,
  count(*) FILTER (WHERE event = 'completed')                   AS completed,
  count(*) FILTER (WHERE event = 'abandoned')                   AS abandoned,
  round(100.0 * count(*) FILTER (WHERE event = 'completed')
        / nullif(count(*) FILTER (WHERE event = 'started'), 0)) AS completed_pct,
  count(DISTINCT "userId")                                      AS people
FROM "GuideEvent", params
WHERE "createdAt" >= params.since
GROUP BY "guideId"
ORDER BY started DESC;

-- 2. Where they give up: guide x step x reason, most first.
WITH params AS (SELECT now() - interval '30 days' AS since),
steps(guide, step, name) AS (VALUES
    ('salonProfile', 0, 'openPage'),
    ('salonProfile', 1, 'phone'),
    ('salonProfile', 2, 'address'),
    ('salonProfile', 3, 'save'),
    ('salonProfile', 4, 'done'),
    ('addService', 0, 'openPage'),
    ('addService', 1, 'openForm'),
    ('addService', 2, 'name'),
    ('addService', 3, 'price'),
    ('addService', 4, 'duration'),
    ('addService', 5, 'save'),
    ('addService', 6, 'done'),
    ('addAddon', 0, 'openPage'),
    ('addAddon', 1, 'openForm'),
    ('addAddon', 2, 'name'),
    ('addAddon', 3, 'price'),
    ('addAddon', 4, 'services'),
    ('addAddon', 5, 'save'),
    ('addAddon', 6, 'done'),
    ('addWorker', 0, 'openPage'),
    ('addWorker', 1, 'openForm'),
    ('addWorker', 2, 'name'),
    ('addWorker', 3, 'services'),
    ('addWorker', 4, 'hours'),
    ('addWorker', 5, 'save'),
    ('addWorker', 6, 'done'),
    ('workingHours', 0, 'openWorkers'),
    ('workingHours', 1, 'edit'),
    ('workingHours', 2, 'hours'),
    ('workingHours', 3, 'save'),
    ('workingHours', 4, 'openSettings'),
    ('workingHours', 5, 'salonHours'),
    ('workingHours', 6, 'salonHoursSave'),
    ('workingHours', 7, 'done'),
    ('bookingLink', 0, 'openPage'),
    ('bookingLink', 1, 'copy'),
    ('bookingLink', 2, 'instagram'),
    ('bookingLink', 3, 'done'),
    ('manualBooking', 0, 'openPage'),
    ('manualBooking', 1, 'openForm'),
    ('manualBooking', 2, 'employee'),
    ('manualBooking', 3, 'service'),
    ('manualBooking', 4, 'slot'),
    ('manualBooking', 5, 'name'),
    ('manualBooking', 6, 'phone'),
    ('manualBooking', 7, 'save'),
    ('manualBooking', 8, 'done'),
    ('masterLogin', 0, 'openPage'),
    ('masterLogin', 1, 'openAccess'),
    ('masterLogin', 2, 'email'),
    ('masterLogin', 3, 'password'),
    ('masterLogin', 4, 'save'),
    ('masterLogin', 5, 'handOver'),
    ('masterLogin', 6, 'done'),
    ('timeOff', 0, 'openPage'),
    ('timeOff', 1, 'openModal'),
    ('timeOff', 2, 'from'),
    ('timeOff', 3, 'to'),
    ('timeOff', 4, 'reason'),
    ('timeOff', 5, 'save'),
    ('timeOff', 6, 'done'),
    ('timeOffReception', 0, 'openPage'),
    ('timeOffReception', 1, 'openModal'),
    ('timeOffReception', 2, 'from'),
    ('timeOffReception', 3, 'to'),
    ('timeOffReception', 4, 'reason'),
    ('timeOffReception', 5, 'save'),
    ('timeOffReception', 6, 'done'),
    ('lunchBreak', 0, 'openPage'),
    ('lunchBreak', 1, 'edit'),
    ('lunchBreak', 2, 'breakOn'),
    ('lunchBreak', 3, 'breakTime'),
    ('lunchBreak', 4, 'save'),
    ('lunchBreak', 5, 'done'),
    ('payPlan', 0, 'openPage'),
    ('payPlan', 1, 'status'),
    ('payPlan', 2, 'pay'),
    ('payPlan', 3, 'done')
)
SELECT
  e."guideId"                AS guide,
  e.step,
  coalesce(s.name, '?')      AS step_name,
  e.reason,
  count(*)                   AS times,
  count(DISTINCT e."userId") AS people
FROM "GuideEvent" e
CROSS JOIN params
LEFT JOIN steps s ON s.guide = e."guideId" AND s.step = e.step
WHERE e.event = 'abandoned' AND e."createdAt" >= params.since
GROUP BY e."guideId", e.step, s.name, e.reason
ORDER BY times DESC
LIMIT 50;

-- 3. Anchors that were not found, newest first: a screen changed under a guide.
WITH params AS (SELECT now() - interval '30 days' AS since)
SELECT "guideId" AS guide, step, count(*) AS times, max("createdAt") AS last_seen
FROM "GuideEvent", params
WHERE event = 'abandoned' AND reason = 'not_found' AND "createdAt" >= params.since
GROUP BY "guideId", step
ORDER BY last_seen DESC;
