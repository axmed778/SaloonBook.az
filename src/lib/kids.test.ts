import { describe, it, expect } from "vitest";
import { matchesClientGender, type Audience } from "./audience";
import {
  bookingClientSetup,
  employeeFitsClient,
  kidsFlags,
  kidsFlagsFromCounts,
  presetClientFor,
  serviceFitsClient,
} from "./kids";

const svc = (audience: Audience, forKids = false) => ({ audience, forKids });
const emp = (audience: Audience, worksWithKids = true) => ({ audience, worksWithKids });

describe("kidsFlags", () => {
  it("no kids' service: neither flag", () => {
    expect(kidsFlags([{ forKids: false }, { forKids: false }])).toEqual({
      hasKids: false,
      kidsOnly: false,
    });
  });
  it("some kids' services: hasKids only", () => {
    expect(kidsFlags([{ forKids: true }, { forKids: false }])).toEqual({
      hasKids: true,
      kidsOnly: false,
    });
  });
  it("only kids' services: kids-only salon", () => {
    expect(kidsFlags([{ forKids: true }])).toEqual({ hasKids: true, kidsOnly: true });
  });
  it("no services at all is not a kids salon", () => {
    expect(kidsFlags([])).toEqual({ hasKids: false, kidsOnly: false });
  });
});

describe("kidsFlagsFromCounts", () => {
  it("combines the kids' service count with whether any adult service exists", () => {
    expect(kidsFlagsFromCounts(0, true)).toEqual({ hasKids: false, kidsOnly: false });
    // No services that count at all is still not a kids salon.
    expect(kidsFlagsFromCounts(0, false)).toEqual({ hasKids: false, kidsOnly: false });
    expect(kidsFlagsFromCounts(2, true)).toEqual({ hasKids: true, kidsOnly: false });
    expect(kidsFlagsFromCounts(2, false)).toEqual({ hasKids: true, kidsOnly: true });
  });
});

describe("bookingClientSetup", () => {
  // Backward compatibility: a salon without kids' services gets the old steps.
  it("unisex salon, no kids' services: the old Men / Women step", () => {
    expect(bookingClientSetup("ALL", [svc("ALL"), svc("MALE")])).toEqual({
      options: ["MALE", "FEMALE"],
      fixed: null,
    });
  });
  it("gendered salon, no kids' services: no step, the salon's gender", () => {
    expect(bookingClientSetup("FEMALE", [svc("ALL")])).toEqual({
      options: null,
      fixed: "FEMALE",
    });
  });
  it("salon with no services: unchanged behaviour", () => {
    expect(bookingClientSetup("ALL", [])).toEqual({ options: ["MALE", "FEMALE"], fixed: null });
    expect(bookingClientSetup("MALE", [])).toEqual({ options: null, fixed: "MALE" });
  });

  it("unisex salon with kids' services: Men / Women / Kids", () => {
    expect(bookingClientSetup("ALL", [svc("ALL"), svc("ALL", true)])).toEqual({
      options: ["MALE", "FEMALE", "KID"],
      fixed: null,
    });
  });
  it("gendered salon with kids' services: its gender (Adult) / Kids", () => {
    expect(bookingClientSetup("MALE", [svc("MALE"), svc("ALL", true)])).toEqual({
      options: ["MALE", "KID"],
      fixed: null,
    });
  });
  it("kids-only salon: no step, always a child", () => {
    expect(bookingClientSetup("ALL", [svc("ALL", true), svc("FEMALE", true)])).toEqual({
      options: null,
      fixed: "KID",
    });
  });
});

describe("serviceFitsClient", () => {
  it("adults keep the gender rule and never see kids' services", () => {
    for (const a of ["MALE", "FEMALE", "ALL"] as Audience[]) {
      for (const g of ["MALE", "FEMALE"] as const) {
        expect(serviceFitsClient(svc(a), g)).toBe(matchesClientGender(a, g));
        expect(serviceFitsClient(svc(a, true), g)).toBe(false);
      }
    }
  });
  it("a child sees only kids' services, whatever their audience", () => {
    expect(serviceFitsClient(svc("ALL", true), "KID")).toBe(true);
    expect(serviceFitsClient(svc("MALE", true), "KID")).toBe(true);
    expect(serviceFitsClient(svc("ALL"), "KID")).toBe(false);
  });
});

describe("employeeFitsClient", () => {
  it("adults keep the gender rule; the kids switch doesn't matter", () => {
    expect(employeeFitsClient(emp("FEMALE", false), "FEMALE")).toBe(true);
    expect(employeeFitsClient(emp("FEMALE", true), "MALE")).toBe(false);
    expect(employeeFitsClient(emp("ALL", false), "MALE")).toBe(true);
  });
  it("a child gets only masters who work with children, gender ignored", () => {
    expect(employeeFitsClient(emp("FEMALE", true), "KID")).toBe(true);
    expect(employeeFitsClient(emp("MALE", true), "KID")).toBe(true);
    expect(employeeFitsClient(emp("ALL", false), "KID")).toBe(false);
  });
});

describe("presetClientFor", () => {
  it("matches the old book-again rule for adult services", () => {
    expect(presetClientFor("MALE", svc("ALL"))).toBe("MALE");
    expect(presetClientFor("ALL", svc("FEMALE"))).toBe("FEMALE");
    expect(presetClientFor("ALL", svc("ALL"))).toBeNull();
  });
  it("a kids' service pins a child", () => {
    expect(presetClientFor("ALL", svc("ALL", true))).toBe("KID");
    expect(presetClientFor("FEMALE", svc("ALL", true))).toBe("KID");
  });
});
