import { describe, expect, it } from "vitest";

import { channelLabel, paymentModeText } from "./methods";

describe("payment modes", () => {
  it("labels each mode", () => {
    expect(channelLabel("pos")).toBe("POS");
    expect(channelLabel("mobile_money")).toBe("Mobile money");
  });

  it("falls back to cash / transfer for records without a mode", () => {
    expect(channelLabel(null, "transfer")).toBe("Bank transfer");
    expect(channelLabel(undefined, "cash")).toBe("Cash");
  });

  it("adds the reference when there is one", () => {
    expect(paymentModeText("pos", "Moniepoint 4471")).toBe("POS · Moniepoint 4471");
    expect(paymentModeText("cash", null)).toBe("Cash");
  });
});
