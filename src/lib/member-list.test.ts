import { describe, expect, it } from "vitest";

import { filterMembers, sortMembers, summarize, type MemberRow } from "@/lib/member-list";

const row = (name: string, extra: Partial<MemberRow> = {}): MemberRow => ({
  id: name,
  name,
  phone: null,
  active: true,
  tags: [],
  branch: null,
  owing: 0,
  ...extra,
});

const rows = [
  row("Chidi", { owing: 5000, phone: "0803", branch: "Lagos", tags: ["Youth"] }),
  row("ada", { owing: 0, phone: "0801", branch: "Abuja" }),
  row("Bola", { owing: 12000, tags: ["Youth"] }),
  row("Emeka", { owing: null, active: false, branch: "Lagos" }),
];

const names = (r: MemberRow[]) => r.map((m) => m.name);

describe("sortMembers", () => {
  it("sorts by name ignoring case", () => {
    expect(names(sortMembers(rows, "name", "asc"))).toEqual(["ada", "Bola", "Chidi", "Emeka"]);
    expect(names(sortMembers(rows, "name", "desc"))).toEqual(["Emeka", "Chidi", "Bola", "ada"]);
  });

  it("puts the biggest debts first, with inactive members last", () => {
    expect(names(sortMembers(rows, "owing", "desc"))).toEqual(["Bola", "Chidi", "ada", "Emeka"]);
  });

  it("keeps blank phones and branches at the end either way", () => {
    expect(names(sortMembers(rows, "phone", "asc"))).toEqual(["ada", "Chidi", "Bola", "Emeka"]);
    expect(names(sortMembers(rows, "phone", "desc"))).toEqual(["Chidi", "ada", "Bola", "Emeka"]);
    expect(names(sortMembers(rows, "branch", "asc"))).toEqual(["ada", "Chidi", "Emeka", "Bola"]);
  });

  it("does not change the list it was given", () => {
    sortMembers(rows, "owing", "desc");
    expect(names(rows)).toEqual(["Chidi", "ada", "Bola", "Emeka"]);
  });
});

describe("filterMembers and summarize", () => {
  it("filters by search, label and owing", () => {
    const f = { search: "", tag: "all", owingOnly: false };
    expect(filterMembers(rows, { ...f, owingOnly: true }).map((m) => m.name)).toEqual([
      "Chidi",
      "Bola",
    ]);
    expect(filterMembers(rows, { ...f, tag: "Youth" })).toHaveLength(2);
    expect(filterMembers(rows, { ...f, search: "0801" }).map((m) => m.name)).toEqual(["ada"]);
  });

  it("counts who owes and how much", () => {
    expect(summarize(rows)).toEqual({ members: 4, owing: 2, total: 17000 });
  });
});
