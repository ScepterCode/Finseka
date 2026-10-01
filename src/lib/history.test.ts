import { describe, expect, it } from "vitest";

import { describeChange, type Entry } from "./history";

const names = new Map([
  ["m1", "Bola"],
  ["c1", "Burial"],
  ["u1", "Vic"],
]);

const entry = (e: Partial<Entry>): Entry => ({
  id: 1,
  actor_id: null,
  table_name: "members",
  action: "insert",
  old_row: null,
  new_row: null,
  at: "2026-09-25T10:00:00Z",
  ...e,
});

describe("describeChange", () => {
  it("describes FinSeka support opening and leaving an organization", () => {
    const start = entry({
      table_name: "support_access",
      action: "start",
      new_row: { reason: "Bola asked for help" },
    });
    expect(describeChange(start, names)).toBe("opened your records to help — Bola asked for help");
    expect(describeChange({ ...start, action: "end" }, names)).toBe(
      "finished working in your records",
    );
  });

  it("describes a dues payment", () => {
    const text = describeChange(
      entry({
        table_name: "due_payments",
        new_row: { amount: 400, member_id: "m1", period_label: "Sep 2026" },
      }),
      names,
    );
    expect(text).toBe("recorded a dues payment of ₦400 for Bola (Sep 2026)");
  });

  it("describes a cancelled payment with its reason", () => {
    const text = describeChange(
      entry({
        table_name: "due_payments",
        action: "update",
        old_row: { amount: 400, member_id: "m1", voided_at: null },
        new_row: {
          amount: 400,
          member_id: "m1",
          voided_at: "2026-09-25T10:00:00Z",
          void_reason: "Recorded for the wrong member",
        },
      }),
      names,
    );
    expect(text).toBe("cancelled a dues payment of ₦400 for Bola — Recorded for the wrong member");
  });

  it("lists which member details changed", () => {
    const text = describeChange(
      entry({
        action: "update",
        old_row: { name: "Bola", phone: null, active: true },
        new_row: { name: "Bola Ade", phone: "0803", active: true },
      }),
      names,
    );
    expect(text).toBe("edited member Bola Ade: changed name, phone");
  });

  it("describes posting event spending", () => {
    const text = describeChange(
      entry({
        table_name: "contributions",
        action: "update",
        old_row: { name: "Burial", expenses_posted: false },
        new_row: { name: "Burial", expenses_posted: true },
      }),
      names,
    );
    expect(text).toBe("closed Burial and posted its spending to the ledger");
  });

  it("describes a reversal and a role grant", () => {
    expect(
      describeChange(
        entry({
          table_name: "ledger_entries",
          new_row: { reverses_id: "x", description: "Reversed: Chairs — returned" },
        }),
        names,
      ),
    ).toBe("reversed a ledger line — Reversed: Chairs — returned");
    expect(
      describeChange(
        entry({ table_name: "user_roles", new_row: { user_id: "u1", role: "viewer" } }),
        names,
      ),
    ).toBe("gave Vic viewer access");
  });
});
