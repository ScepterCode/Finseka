import { afterEach, describe, expect, it, vi } from "vitest";

import { initials, localIso, naira, todayIso } from "./format";

afterEach(() => vi.useRealTimers());

describe("naira", () => {
  it("formats amounts with the naira sign and thousands separators", () => {
    expect(naira(120000)).toBe("₦120,000");
    expect(naira("2500.5")).toBe("₦2,500.5");
    expect(naira(null)).toBe("₦0");
  });
});

describe("dates", () => {
  it("localIso pads month and day", () => {
    expect(localIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("todayIso is the local date just after midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 0, 15));
    expect(todayIso()).toBe("2026-10-01");
  });
});

describe("initials", () => {
  it("takes the first letters of the first two names", () => {
    expect(initials("chinedu okeke obi")).toBe("CO");
    expect(initials("Ada")).toBe("A");
    expect(initials("  ")).toBe("");
  });
});
