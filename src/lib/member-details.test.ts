import { describe, expect, it } from "vitest";

import { debtKey } from "./debts";
import { describeChange, type Entry } from "./history";
import { detailsFromRow, detailsList, detailsToRow, emptyDetails } from "./member-details";

describe("member details", () => {
  it("saves blanks as nothing, and trims what is typed", () => {
    expect(detailsToRow({ ...emptyDetails, email: "  ada@example.com ", address: "   " })).toEqual({
      email: "ada@example.com",
      gender: null,
      date_of_birth: null,
      address: null,
      occupation: null,
      next_of_kin_name: null,
      next_of_kin_phone: null,
    });
  });

  it("round-trips through the database shape", () => {
    const row = detailsToRow({ ...emptyDetails, gender: "female", dateOfBirth: "1990-02-03" });
    expect(detailsFromRow(row)).toEqual({
      ...emptyDetails,
      gender: "female",
      dateOfBirth: "1990-02-03",
    });
  });

  it("lists only what is filled in, next of kin on one line", () => {
    const list = detailsList({
      ...emptyDetails,
      gender: "male",
      nextOfKinName: "Ngozi",
      nextOfKinPhone: "0803",
    });
    expect(list).toEqual([
      { label: "Gender", value: "Male" },
      { label: "Next of kin", value: "Ngozi · 0803" },
    ]);
    expect(detailsList(emptyDetails)).toEqual([]);
  });
});

describe("debt keys", () => {
  it("tells due periods and contributions apart", () => {
    expect(
      debtKey({
        kind: "due",
        dueId: "d1",
        periodStart: "2026-08-01",
        periodLabel: "Aug 2026",
        title: "Monthly — Aug 2026",
        owing: 1000,
        penalty: 0,
      }),
    ).toBe("due:d1:2026-08-01");
    expect(
      debtKey({ kind: "contribution", contributionId: "c1", title: "Burial", owing: 2000 }),
    ).toBe("contribution:c1");
  });
});

describe("pledge history", () => {
  const entry = (e: Partial<Entry>): Entry => ({
    id: 1,
    actor_id: null,
    table_name: "pledges",
    action: "insert",
    old_row: null,
    new_row: null,
    at: "2026-09-29T10:00:00Z",
    ...e,
  });
  const names = new Map<string, string>();

  it("describes pledges, cancellations and redemptions", () => {
    expect(
      describeChange(entry({ new_row: { amount: 5000, pledger_name: "Chief Okafor" } }), names),
    ).toBe("recorded a pledge of ₦5,000 from Chief Okafor");
    expect(
      describeChange(
        entry({
          action: "update",
          old_row: { amount: 5000, pledger_name: "Chief Okafor", cancelled_at: null },
          new_row: {
            amount: 5000,
            pledger_name: "Chief Okafor",
            cancelled_at: "2026-09-29",
            cancel_reason: "Moved away",
          },
        }),
        names,
      ),
    ).toBe("cancelled a pledge of ₦5,000 from Chief Okafor — Moved away");
    expect(
      describeChange(entry({ table_name: "pledge_payments", new_row: { amount: 2000 } }), names),
    ).toBe("recorded a pledge payment of ₦2,000");
  });
});
