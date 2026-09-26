import { describe, expect, it } from "vitest";

import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("explains a broken rule in plain words", () => {
    expect(
      friendlyError({
        code: "23514",
        message: 'new row for relation "dues" violates check constraint "dues_amount_positive"',
      }),
    ).toBe("A due must be more than ₦0.");
  });

  it("explains permission errors", () => {
    expect(friendlyError({ code: "42501", message: "permission denied for table members" })).toBe(
      "You don't have permission to do that. Only admins can make changes.",
    );
  });

  it("explains network failures", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/internet connection/);
  });

  it("passes our own database messages through", () => {
    expect(friendlyError({ message: "Say why this payment is being cancelled." })).toBe(
      "Say why this payment is being cancelled.",
    );
  });
});
