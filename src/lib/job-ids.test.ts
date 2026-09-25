import { describe, expect, it } from "vitest";
import {
  deferJobId,
  igProfileJobId,
  jobId,
  notificationJobId,
  pushJobId,
  reviveJobId,
} from "./job-ids";

/**
 * BullMQ's own validation, mirrored from Job.validateOptions
 * (node_modules/bullmq/dist/cjs/classes/job.js, "Custom Id cannot contain :").
 *
 * Mirrored rather than imported because the check is private and only reachable
 * through add(), i.e. only with a live Redis — which is exactly why the invalid
 * ids this module replaced reached production in the first place.
 */
function bullmqRejects(id: string): string | null {
  if (`${parseInt(id, 10)}` === id) return "Custom Id cannot be integers";
  if (id.includes(":") && id.split(":").length !== 3) return "Custom Id cannot contain :";
  return null;
}

const NOTIFICATION_ID = "c31687d3-bcfe-4e45-9cee-72b21b3373b6";
const APPOINTMENT_ID = "7f89afd7-2de1-4e73-81bf-53c8dd3a6fc2";
const IGSID = "17841400000000000";
const AT = new Date("2026-09-25T05:50:00.000Z");

describe("job ids", () => {
  // The whole point of the module: not "BullMQ happens to accept this", but
  // "there is no colon in it at all". BullMQ tolerates an id of exactly three
  // colon-separated parts for legacy reasons, which is a trap — it let
  // `ig-profile:<igsid>:<day>` through while rejecting `<id>:r<n>`, so the bug
  // looked like it only affected some call sites.
  const every: Array<[string, string]> = [
    ["notificationJobId", notificationJobId(NOTIFICATION_ID)],
    ["reviveJobId", reviveJobId(NOTIFICATION_ID, 8)],
    ["deferJobId", deferJobId(NOTIFICATION_ID, AT)],
    ["pushJobId/new_booking", pushJobId("new_booking", APPOINTMENT_ID)],
    ["pushJobId/reminder", pushJobId("reminder", APPOINTMENT_ID)],
    ["pushJobId/cancelled", pushJobId("booking_cancelled", APPOINTMENT_ID)],
    ["igProfileJobId", igProfileJobId(IGSID, AT)],
  ];

  it.each(every)("%s contains no colon", (_name, id) => {
    expect(id).not.toContain(":");
  });

  it.each(every)("%s is accepted by BullMQ's validation", (_name, id) => {
    expect(bullmqRejects(id)).toBeNull();
  });

  it("strips a colon that arrives inside a part", () => {
    // The failure mode this guards: someone bucketing by an ISO timestamp.
    const id = jobId("digest", "2026-09-25T05:50:00.000Z");
    expect(id).not.toContain(":");
    expect(bullmqRejects(id)).toBeNull();
  });

  it("dedupes a revival per attempt count, not per sweep pass", () => {
    // Two passes before the worker touches the row collapse into one job…
    expect(reviveJobId(NOTIFICATION_ID, 8)).toBe(reviveJobId(NOTIFICATION_ID, 8));
    // …while a new round of attempts gets past the dead job holding the old id.
    expect(reviveJobId(NOTIFICATION_ID, 8)).not.toBe(reviveJobId(NOTIFICATION_ID, 16));
  });

  it("buckets a deferred re-check by target minute", () => {
    const a = deferJobId(NOTIFICATION_ID, new Date("2026-09-25T05:50:10.000Z"));
    const b = deferJobId(NOTIFICATION_ID, new Date("2026-09-25T05:50:59.000Z"));
    const later = deferJobId(NOTIFICATION_ID, new Date("2026-09-25T05:51:00.000Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(later);
  });

  it("buckets a profile lookup by UTC day", () => {
    const morning = igProfileJobId(IGSID, new Date("2026-09-25T00:30:00.000Z"));
    const evening = igProfileJobId(IGSID, new Date("2026-09-25T23:30:00.000Z"));
    const tomorrow = igProfileJobId(IGSID, new Date("2026-09-26T00:30:00.000Z"));
    expect(morning).toBe(evening);
    expect(morning).not.toBe(tomorrow);
  });

  it("keeps push events for one appointment distinct", () => {
    expect(pushJobId("reminder", APPOINTMENT_ID)).not.toBe(
      pushJobId("new_booking", APPOINTMENT_ID),
    );
  });

  it("does not let a suffixed id collide with a plain notification id", () => {
    // enqueueNotification and reviveNotification share a queue, so a revival id
    // must never be mistaken for some other row's delivery id.
    expect(reviveJobId(NOTIFICATION_ID, 8)).not.toBe(notificationJobId(NOTIFICATION_ID));
  });
});
