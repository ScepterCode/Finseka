import { describe, expect, it } from "vitest";

import type { Billing } from "@/hooks/useAuth";

import { billingSummary, daysUntil } from "./billing";

const now = new Date("2026-10-01T09:00:00Z").getTime();
const base: Billing = {
  status: "trial",
  can_write: true,
  trial_ends_at: "2026-10-13T09:00:00Z",
  paid_until: null,
  grace_ends_at: null,
  free_plan: false,
  provider: null,
  auto_renew: false,
  price: 5000,
};

describe("billing wording", () => {
  it("counts whole days left, never below zero", () => {
    expect(daysUntil("2026-10-13T09:00:00Z", now)).toBe(12);
    expect(daysUntil("2026-10-01T10:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-09-01T00:00:00Z", now)).toBe(0);
  });

  it("describes each plan", () => {
    expect(billingSummary(base, now)).toMatch(/^Free trial — 12 days left/);
    expect(
      billingSummary(
        { ...base, status: "active", paid_until: "2026-11-01T00:00:00Z", auto_renew: true },
        now,
      ),
    ).toMatch(/^Pro — paid until .*renews automatically$/);
    expect(billingSummary({ ...base, status: "read_only", can_write: false }, now)).toBe(
      "Plan ended — records can be seen but not changed, downloaded or printed",
    );
    expect(billingSummary({ ...base, status: "free", free_plan: true }, now)).toBe(
      "Free plan, given by FinSeka",
    );
  });
});
