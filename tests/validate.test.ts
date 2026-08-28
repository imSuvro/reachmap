import { describe, expect, it } from "vitest";
import { summarizeReport } from "../pipeline/validate";

const report = JSON.stringify({
  notices: [
    { severity: "ERROR", code: "invalid_row_length", totalNotices: 146 },
    { severity: "ERROR", code: "invalid_integer", totalNotices: 3 },
    { severity: "WARNING", code: "fast_travel_between_consecutive_stops", totalNotices: 12 },
    { severity: "INFO", code: "unknown_column", totalNotices: 4 },
  ],
});

describe("validator gate", () => {
  it("passes when every ERROR code is allowlisted, with exact counts", () => {
    const s = summarizeReport(report, ["invalid_row_length", "invalid_integer"]);
    expect(s.errors).toBe(149);
    expect(s.warnings).toBe(12);
    expect(s.allowlisted).toEqual(["invalid_integer", "invalid_row_length"]);
  });

  it("fails on any ERROR code outside the allowlist, naming it", () => {
    expect(() => summarizeReport(report, ["invalid_row_length"])).toThrow(/invalid_integer x3/);
  });

  it("passes a clean report with an empty allowlist", () => {
    const s = summarizeReport(JSON.stringify({ notices: [] }), []);
    expect(s.errors).toBe(0);
  });
});
