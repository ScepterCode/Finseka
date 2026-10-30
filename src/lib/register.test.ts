import { describe, expect, it } from "vitest";

import {
  countByFilter,
  matchesFilter,
  payStatus,
  sortRegister,
  type RegisterRow,
} from "@/lib/register";

const row = (name: string, paid: number, owing: number, date: string | null): RegisterRow => ({
  name,
  status: payStatus(paid, paid + owing),
  paid,
  owing,
  date,
});

const rows = [
  row("Chidi", 5000, 0, "2026-10-03"),
  row("ada", 0, 5000, null),
  row("Bola", 2000, 3000, "2026-10-10"),
  row("Emeka", 0, 5000, null),
];
const names = (r: RegisterRow[]) => r.map((m) => m.name);

describe("payStatus", () => {
  it("works out paid, part and not paid", () => {
    expect(payStatus(5000, 5000)).toBe("paid");
    expect(payStatus(6000, 5000)).toBe("paid");
    expect(payStatus(1, 5000)).toBe("part");
    expect(payStatus(0, 5000)).toBe("unpaid");
    expect(payStatus(0, 0)).toBe("unpaid");
  });

  it("counts any amount as given when there is no set amount", () => {
    expect(payStatus(200, 0, false)).toBe("gave");
    expect(payStatus(0, 0, false)).toBe("unpaid");
  });
});

describe("sortRegister", () => {
  it("puts people who have not paid first, then part paid, then paid", () => {
    expect(names(sortRegister(rows, "status", "asc"))).toEqual(["ada", "Emeka", "Bola", "Chidi"]);
  });

  it("sorts by money owed and paid", () => {
    expect(names(sortRegister(rows, "owing", "desc"))).toEqual(["ada", "Emeka", "Bola", "Chidi"]);
    expect(names(sortRegister(rows, "paid", "desc"))).toEqual(["Chidi", "Bola", "ada", "Emeka"]);
  });

  it("puts the latest payment first and people who never paid last", () => {
    expect(names(sortRegister(rows, "date", "desc"))).toEqual(["Bola", "Chidi", "ada", "Emeka"]);
    expect(names(sortRegister(rows, "date", "asc"))).toEqual(["Chidi", "Bola", "ada", "Emeka"]);
  });

  it("sorts by name ignoring case", () => {
    expect(names(sortRegister(rows, "name", "asc"))).toEqual(["ada", "Bola", "Chidi", "Emeka"]);
  });
});

describe("filters", () => {
  it("counts each tab, with gifts counted as paid", () => {
    expect(countByFilter(rows)).toEqual({ all: 4, paid: 1, part: 1, unpaid: 2 });
    expect(countByFilter([{ status: "gave" }])).toEqual({ all: 1, paid: 1, part: 0, unpaid: 0 });
  });

  it("matches gifts under paid", () => {
    expect(matchesFilter("gave", "paid")).toBe(true);
    expect(matchesFilter("part", "unpaid")).toBe(false);
    expect(matchesFilter("part", "all")).toBe(true);
  });
});
