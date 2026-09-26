import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  currentPeriod,
  isPastPeriod,
  periodEntries,
  standingPeriods,
  STANDING_LOOKBACK,
} from "./periods";

// Friday 25 September 2026, mid-afternoon local time.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 25, 15, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe("period labels", () => {
  it("monthly: newest first, with each month's last day", () => {
    const p = periodEntries("monthly");
    expect(p.slice(0, 3)).toEqual([
      { label: "Sep 2026", ends_on: "2026-09-30" },
      { label: "Aug 2026", ends_on: "2026-08-31" },
      { label: "Jul 2026", ends_on: "2026-07-31" },
    ]);
    expect(p).toHaveLength(14);
  });

  it("monthly: February and the turn of the year", () => {
    const p = periodEntries("monthly");
    expect(p.find((x) => x.label === "Feb 2026")?.ends_on).toBe("2026-02-28");
    expect(p.find((x) => x.label === "Dec 2025")?.ends_on).toBe("2025-12-31");
  });

  it("yearly and daily", () => {
    expect(periodEntries("yearly")[0]).toEqual({ label: "2026", ends_on: "2026-12-31" });
    expect(periodEntries("daily").slice(0, 2)).toEqual([
      { label: "25 Sep 2026", ends_on: "2026-09-25" },
      { label: "24 Sep 2026", ends_on: "2026-09-24" },
    ]);
  });

  it("weekly: weeks end on Saturday", () => {
    expect(periodEntries("weekly")[0]?.ends_on).toBe("2026-09-26");
    expect(new Date(2026, 8, 26).getDay()).toBe(6);
  });

  it("custom dues have a single, never-ending period", () => {
    expect(periodEntries("custom")).toEqual([{ label: "All time", ends_on: null }]);
    expect(isPastPeriod("custom", "All time")).toBe(false);
  });

  it("only the current period is not past", () => {
    expect(currentPeriod("monthly")).toBe("Sep 2026");
    expect(isPastPeriod("monthly", "Sep 2026")).toBe(false);
    expect(isPastPeriod("monthly", "Aug 2026")).toBe(true);
  });

  it("uses the local date, not UTC, just after midnight", () => {
    vi.setSystemTime(new Date(2026, 9, 1, 0, 30, 0)); // 00:30 on 1 October
    expect(currentPeriod("monthly")).toBe("Oct 2026");
    expect(periodEntries("daily")[0]?.label).toBe("1 Oct 2026");
  });
});

describe("standingPeriods (sent to the database)", () => {
  it("covers every frequency with the lookback window", () => {
    const s = standingPeriods();
    expect(Object.keys(s).sort()).toEqual(["custom", "daily", "monthly", "weekly", "yearly"]);
    expect(s.monthly).toHaveLength(STANDING_LOOKBACK);
    expect(s.custom).toHaveLength(1);
  });
});
