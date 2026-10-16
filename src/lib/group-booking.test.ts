import { describe, it, expect } from "vitest";
import { bookingBlockMin, peopleOrOne } from "./group-booking";

describe("bookingBlockMin", () => {
  it("is service + add-ons + buffer for one person", () => {
    expect(bookingBlockMin({ durationMin: 60, extraMin: 15, bufferMin: 10 })).toBe(85);
  });

  it("repeats the per-person work back to back and keeps one buffer at the end", () => {
    // 3 people × (60 + 15) + 10 — not 3 × (60 + 15 + 10).
    expect(bookingBlockMin({ durationMin: 60, extraMin: 15, bufferMin: 10, people: 3 })).toBe(235);
  });
});

describe("peopleOrOne", () => {
  it("reads anything missing or nonsensical as one person", () => {
    expect(peopleOrOne(undefined)).toBe(1);
    expect(peopleOrOne(null)).toBe(1);
    expect(peopleOrOne(0)).toBe(1);
    expect(peopleOrOne(-2)).toBe(1);
    expect(peopleOrOne(2.5)).toBe(1);
    expect(peopleOrOne(4)).toBe(4);
  });
});
