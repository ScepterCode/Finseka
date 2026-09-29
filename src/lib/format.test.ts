import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanAmount, groupAmount, initials, localIso, naira, todayIso } from "./format";

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

describe("money box", () => {
  it("cleanAmount strips commas and junk, keeps one decimal point and two places", () => {
    expect(cleanAmount("1,000,000")).toBe("1000000");
    expect(cleanAmount("₦ 2,500.5")).toBe("2500.5");
    expect(cleanAmount("12.345")).toBe("12.34");
    expect(cleanAmount("1.2.3")).toBe("1.23");
    expect(cleanAmount("007")).toBe("7");
    expect(cleanAmount(".5")).toBe("0.5");
    expect(cleanAmount("0")).toBe("0");
    expect(cleanAmount("")).toBe("");
  });

  it("groupAmount adds thousands commas", () => {
    expect(groupAmount("100")).toBe("100");
    expect(groupAmount("1000")).toBe("1,000");
    expect(groupAmount("10000000")).toBe("10,000,000");
    expect(groupAmount("1234.")).toBe("1,234.");
    expect(groupAmount("1234.5")).toBe("1,234.5");
    expect(groupAmount("")).toBe("");
  });
});
