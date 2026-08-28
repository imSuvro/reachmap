import { describe, expect, it } from "vitest";
import {
  addDays,
  hmsToSec,
  isoToInt,
  sanitizeFeedString,
  splitCsv,
  weekdayOf,
} from "../pipeline/gtfs";

describe("csv", () => {
  it("splits plain rows", () => {
    expect(splitCsv("a,b,,d")).toEqual(["a", "b", "", "d"]);
  });
  it("handles quoted commas and escaped quotes", () => {
    expect(splitCsv('a,"b, with comma","she said ""hi""",d')).toEqual([
      "a",
      "b, with comma",
      'she said "hi"',
      "d",
    ]);
  });
});

describe("hmsToSec", () => {
  it("parses normal and >24:00 times, preserving raw seconds", () => {
    expect(hmsToSec("08:30:00")).toBe(30600);
    expect(hmsToSec("25:10:00")).toBe(90600);
    expect(hmsToSec("29:59:59")).toBe(107999);
  });
  it("returns -1 for blank and malformed values", () => {
    expect(hmsToSec("")).toBe(-1);
    expect(hmsToSec(undefined)).toBe(-1);
    expect(hmsToSec("8:30")).toBe(-1);
    expect(hmsToSec("aa:bb:cc")).toBe(-1);
    expect(hmsToSec("08:61:00")).toBe(-1);
  });
});

describe("sanitizeFeedString", () => {
  it("removes control chars, keeps punctuation verbatim, caps at 120", () => {
    expect(sanitizeFeedString("A&B <x> 'q'\x00\x1f\x7f")).toBe("A&B <x> 'q'");
    expect(sanitizeFeedString("x".repeat(200))).toHaveLength(120);
  });
});

describe("dates", () => {
  it("weekdayOf uses Mon=0..Sun=6", () => {
    expect(weekdayOf(20260901)).toBe(1); // Tue
    expect(weekdayOf(20260907)).toBe(0); // Mon
    expect(weekdayOf(20260906)).toBe(6); // Sun
  });
  it("addDays wraps months and years", () => {
    expect(addDays(20261231, 1)).toBe(20270101);
    expect(addDays(20260228, 1)).toBe(20260301);
  });
  it("isoToInt validates", () => {
    expect(isoToInt("2026-09-01")).toBe(20260901);
    expect(() => isoToInt("2026/09/01")).toThrow();
  });
});
