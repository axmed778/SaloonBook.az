import { describe, it, expect, vi } from "vitest";
import {
  addonTotals,
  resolveAddons,
  serviceWithAddons,
  MAX_ADDONS_PER_BOOKING,
} from "./addons";

const SALON = "5a1b2c3d-0000-4000-8000-000000000001";
const SERVICE = "5a1b2c3d-0000-4000-8000-000000000002";
const FRENCH = { id: "a0000000-0000-4000-8000-000000000001", name: "French", priceMinor: 500, durationMin: 0 };
const ART = { id: "a0000000-0000-4000-8000-000000000002", name: "Nail art", priceMinor: 1000, durationMin: 15 };

/** A stand-in for Prisma that returns `rows` and records the query it got. */
function fakeDb(rows: (typeof FRENCH)[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { serviceAddon: { findMany } } as any, findMany };
}

describe("addonTotals", () => {
  it("adds up money and minutes", () => {
    expect(addonTotals([FRENCH, ART])).toEqual({ priceMinor: 1500, durationMin: 15 });
  });

  it("is zero for no add-ons", () => {
    expect(addonTotals([])).toEqual({ priceMinor: 0, durationMin: 0 });
  });
});

describe("serviceWithAddons", () => {
  it("names everything booked on one line", () => {
    expect(serviceWithAddons("Manikür + Gellak", ["French", "Nail art"])).toBe(
      "Manikür + Gellak + French + Nail art",
    );
  });

  it("is just the service when nothing was added", () => {
    expect(serviceWithAddons("Saç kəsimi", [])).toBe("Saç kəsimi");
  });
});

describe("resolveAddons", () => {
  it("asks for nothing when nothing was chosen", async () => {
    const { db, findMany } = fakeDb([]);
    expect(await resolveAddons(db, { salonId: SALON, serviceId: SERVICE })).toEqual([]);
    expect(await resolveAddons(db, { salonId: SALON, serviceId: SERVICE, addonIds: [] })).toEqual(
      [],
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("only accepts this salon's active add-ons linked to this service", async () => {
    const { db, findMany } = fakeDb([FRENCH]);
    await resolveAddons(db, { salonId: SALON, serviceId: SERVICE, addonIds: [FRENCH.id] });
    expect(findMany.mock.calls[0][0].where).toEqual({
      id: { in: [FRENCH.id] },
      salonId: SALON,
      isActive: true,
      services: { some: { serviceId: SERVICE } },
    });
  });

  it("returns the catalog rows when every id checks out", async () => {
    const { db } = fakeDb([FRENCH, ART]);
    expect(
      await resolveAddons(db, { salonId: SALON, serviceId: SERVICE, addonIds: [ART.id, FRENCH.id] }),
    ).toEqual([FRENCH, ART]);
  });

  it("refuses the whole request when any id does not check out", async () => {
    // Two asked for, one found: deactivated, unlinked or another salon's.
    const { db } = fakeDb([FRENCH]);
    expect(
      await resolveAddons(db, { salonId: SALON, serviceId: SERVICE, addonIds: [FRENCH.id, ART.id] }),
    ).toBeNull();
  });

  it("counts a repeated id once, so it cannot be charged twice or fail the count", async () => {
    const { db, findMany } = fakeDb([FRENCH]);
    expect(
      await resolveAddons(db, {
        salonId: SALON,
        serviceId: SERVICE,
        addonIds: [FRENCH.id, FRENCH.id],
      }),
    ).toEqual([FRENCH]);
    expect(findMany.mock.calls[0][0].where.id).toEqual({ in: [FRENCH.id] });
  });

  it("refuses more add-ons than one booking may carry, without querying", async () => {
    const { db, findMany } = fakeDb([]);
    const ids = Array.from(
      { length: MAX_ADDONS_PER_BOOKING + 1 },
      (_, i) => `a0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(await resolveAddons(db, { salonId: SALON, serviceId: SERVICE, addonIds: ids })).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
