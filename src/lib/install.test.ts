import { describe, expect, it } from "vitest";

import { isIos } from "./install";

describe("isIos", () => {
  it("knows iPhones and iPads, including iPads that say they are a Mac", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
  });

  it("leaves out Android phones and real Macs", () => {
    expect(isIos("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(false);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
  });
});
