import { describe, expect, it } from "vitest";

import { financialYearOf, recentFinancialYears } from "./financial-year";

describe("financial years (same rules as the database)", () => {
  it("January start is the calendar year", () => {
    expect(financialYearOf(new Date(2026, 7, 1), 1)).toEqual({
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      label: "FY 2026",
    });
  });

  it("April start runs across two years", () => {
    expect(financialYearOf(new Date(2027, 1, 10), 4)).toEqual({
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      label: "FY 2026/27",
    });
    expect(financialYearOf(new Date(2026, 3, 1), 4).label).toBe("FY 2026/27");
  });

  it("lists recent years newest first", () => {
    expect(recentFinancialYears(new Date(2026, 8, 28), 1, 3).map((y) => y.label)).toEqual([
      "FY 2026",
      "FY 2025",
      "FY 2024",
    ]);
  });
});
