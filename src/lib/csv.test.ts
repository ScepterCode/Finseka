import { describe, expect, it } from "vitest";

import { fileSlug, toCsv } from "./csv";

type Row = { name: string; amount: number; note: string | null };
const columns = [
  { header: "Name", value: (r: Row) => r.name },
  { header: "Amount", value: (r: Row) => r.amount },
  { header: "Note", value: (r: Row) => r.note },
];

describe("toCsv", () => {
  it("writes a header and rows with Windows line endings", () => {
    expect(toCsv([{ name: "Ada", amount: 1000, note: null }], columns)).toBe(
      "Name,Amount,Note\r\nAda,1000,\r\n",
    );
  });

  it("quotes commas, quotes and new lines", () => {
    const csv = toCsv([{ name: 'Okeke, "Chi"', amount: 5, note: "line one\nline two" }], columns);
    expect(csv).toContain('"Okeke, ""Chi"""');
    expect(csv).toContain('"line one\nline two"');
  });

  it("stops text from running as a spreadsheet formula", () => {
    const csv = toCsv([{ name: '=HYPERLINK("x")', amount: 1, note: "+234" }], columns);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+234");
  });

  it("leaves negative numbers as numbers", () => {
    expect(toCsv([{ name: "Reversal", amount: -400, note: null }], columns)).toContain(",-400,");
  });
});

describe("fileSlug", () => {
  it("makes a safe file name", () => {
    expect(fileSlug("Umuahia Town Union — Ledger")).toBe("umuahia-town-union-ledger");
    expect(fileSlug("!!!")).toBe("finseka");
  });
});
