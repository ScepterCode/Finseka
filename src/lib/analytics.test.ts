import { describe, expect, it } from "vitest";

import { collectionRate, lastMonths, monthTick, nairaShort } from "./analytics";

describe("analytics helpers", () => {
  it("covers whole months back from today", () => {
    expect(lastMonths(3, new Date(2026, 8, 28))).toEqual({ from: "2026-07-01", to: "2026-09-28" });
    expect(lastMonths(12, new Date(2026, 1, 10))).toEqual({ from: "2025-03-01", to: "2026-02-10" });
  });

  it("works out the collection rate", () => {
    expect(collectionRate(2000, 1500)).toBe(75);
    expect(collectionRate(0, 0)).toBeNull();
  });

  it("formats axis labels", () => {
    expect(monthTick("2026-09-01")).toBe("Sep 26");
    expect(nairaShort(1500)).toBe("₦1.5k");
    expect(nairaShort(2_400_000)).toBe("₦2.4m");
    expect(nairaShort(800)).toBe("₦800");
    expect(nairaShort(20000)).toBe("₦20k");
  });
});
