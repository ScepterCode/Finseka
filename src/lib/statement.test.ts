import { describe, expect, it } from "vitest";

import { buildStatement } from "./statement";
import type { StandingLine } from "./totals";

const due = (
  period: string,
  start: string,
  end: string,
  paid: number,
  penalty = 0,
): StandingLine => ({
  kind: "due",
  member_id: "m",
  ref_id: "d1",
  ref_name: "Monthly",
  period_label: period,
  is_current: false,
  is_past: true,
  expected: 1000,
  paid,
  short: Math.max(1000 - paid, 0),
  penalty,
  period_start: start,
  period_end: end,
});

describe("buildStatement", () => {
  it("lists charges and payments in date order with a running balance", () => {
    const s = buildStatement(
      [
        due("Aug 2026", "2026-08-01", "2026-08-31", 1000),
        due("Sep 2026", "2026-09-01", "2026-09-30", 400, 200),
      ],
      [
        {
          due_id: "d1",
          amount: 1000,
          paid_at: "2026-08-10",
          period_label: "Aug 2026",
          channel: "cash",
          dues: { name: "Monthly" },
        },
        {
          due_id: "d1",
          amount: 400,
          paid_at: "2026-09-05",
          period_label: "Sep 2026",
          channel: "pos",
          reference: "R1",
          dues: { name: "Monthly" },
        },
      ],
      [],
    );
    expect(s.map((e) => [e.date, e.charged, e.paid, e.balance])).toEqual([
      ["2026-08-01", 1000, 0, 1000],
      ["2026-08-10", 0, 1000, 0],
      ["2026-09-01", 1000, 0, 1000],
      ["2026-09-05", 0, 400, 600],
      ["2026-09-30", 200, 0, 800],
    ]);
    expect(s[3]?.text).toBe("Paid Monthly (Sep 2026) · POS · R1");
    expect(s[4]?.text).toBe("Late charge — Monthly (Sep 2026)");
  });

  it("leaves out cancelled payments and freewill gifts", () => {
    const s = buildStatement(
      [due("Sep 2026", "2026-09-01", "2026-09-30", 0)],
      [
        {
          due_id: "d1",
          amount: 500,
          paid_at: "2026-09-02",
          period_label: "Sep 2026",
          voided_at: "x",
        },
      ],
      [{ contribution_id: "freewill", amount: 300, paid_at: "2026-09-03" }],
    );
    expect(s).toHaveLength(1);
    expect(s[0]?.balance).toBe(1000);
  });

  it("puts a charge before a payment made the same day", () => {
    const s = buildStatement(
      [due("Sep 2026", "2026-09-01", "2026-09-30", 1000)],
      [{ due_id: "d1", amount: 1000, paid_at: "2026-09-01", period_label: "Sep 2026" }],
      [],
    );
    expect(s.map((e) => e.balance)).toEqual([1000, 0]);
  });
});
