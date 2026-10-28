import { describe, expect, it } from "vitest";

import {
  buildImportRows,
  guessMapping,
  newBranches,
  parseAmount,
  parseCsv,
  parseDate,
} from "./member-import";

describe("parseCsv", () => {
  it("reads quoted cells, commas and line breaks inside quotes, and Windows line ends", () => {
    const csv =
      '﻿Name,Address,Owed\r\n"Eze, Ngozi","12 Aba Rd\nUmuahia","5,000"\r\nChidi,,\r\n\r\n';
    expect(parseCsv(csv)).toEqual([
      ["Name", "Address", "Owed"],
      ["Eze, Ngozi", "12 Aba Rd\nUmuahia", "5,000"],
      ["Chidi", "", ""],
    ]);
  });

  it("recognises semicolon- and tab-separated files, and doubled quotes", () => {
    expect(parseCsv('Name;Phone\n"Ada ""Mama"" Obi";0803')).toEqual([
      ["Name", "Phone"],
      ['Ada "Mama" Obi', "0803"],
    ]);
    expect(parseCsv("Name\tPhone\nAda\t0803")).toEqual([
      ["Name", "Phone"],
      ["Ada", "0803"],
    ]);
  });
});

describe("guessMapping", () => {
  it("matches the headings people use, each field once", () => {
    expect(
      guessMapping([
        "Full Name",
        "Phone Number (WhatsApp)",
        "Chapter",
        "Date Joined",
        "Sex",
        "D.O.B",
        "Next of Kin",
        "Next of kin phone no",
        "Amount owed (₦)",
        "Name",
        "Remarks",
      ]),
    ).toEqual([
      "name",
      "phone",
      "branch",
      "joined_on",
      "gender",
      "date_of_birth",
      "next_of_kin_name",
      "next_of_kin_phone",
      "owed",
      null,
      null,
    ]);
  });
});

describe("parseDate", () => {
  it("reads day before month, as in Nigeria", () => {
    expect(parseDate("05/03/2019")).toBe("2019-03-05");
    expect(parseDate("5-3-19")).toBe("2019-03-05");
    expect(parseDate("31.12.2020")).toBe("2020-12-31");
  });
  it("reads other common forms, Excel dates and day numbers", () => {
    expect(parseDate("2019-03-05")).toBe("2019-03-05");
    expect(parseDate("5th March 2019")).toBe("2019-03-05");
    expect(parseDate("March 5, 2019")).toBe("2019-03-05");
    expect(parseDate("2015")).toBe("2015-01-01");
    expect(parseDate(2015)).toBe("2015-01-01");
    expect(parseDate(new Date(Date.UTC(2019, 2, 5)))).toBe("2019-03-05");
    expect(parseDate(43529)).toBe("2019-03-05");
  });
  it("refuses dates that do not exist or cannot be read", () => {
    expect(parseDate("31/02/2020")).toBeNull();
    expect(parseDate("13/13/2020")).toBeNull();
    expect(parseDate("last year")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("reads naira amounts written in different ways", () => {
    expect(parseAmount("₦5,000")).toBe(5000);
    expect(parseAmount("N 2500.50")).toBe(2500.5);
    expect(parseAmount(7000)).toBe(7000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-")).toBeNull();
    expect(parseAmount("five")).toBeNaN();
  });
});

describe("buildImportRows", () => {
  const table = [
    ["Name", "Phone", "Branch", "Joined", "Labels", "Gender", "Email", "Owed"],
    [
      "Ngozi Eze",
      8031234567,
      "Aba",
      "15/03/2019",
      "choir; executive, choir",
      "F",
      "ngozi@example.com",
      "₦5,000",
    ],
    ["", "0805", "", "", "", "", "", ""],
    ["Titus", "12345", "umuahia branch", "someday", "", "x", "not-an-email", "lots"],
    ["ngozi  eze", "", "", "", "", "", "", ""],
    ["Bola", "0803 999 0000", "", "", "", "", "", ""],
  ];
  const rows = buildImportRows(table, guessMapping(table[0] ?? []), [
    { name: "Bola Ade", phone: "+234 803 999 0000" },
  ]);

  it("tidies the values it understands", () => {
    expect(rows[0]).toMatchObject({
      line: 2,
      values: {
        name: "Ngozi Eze",
        phone: "08031234567",
        branch: "Aba",
        joined_on: "2019-03-15",
        tags: ["choir", "executive"],
        gender: "female",
        email: "ngozi@example.com",
        owed: 5000,
      },
      errors: [],
      notes: [],
      duplicateOf: null,
    });
  });

  it("skips a row without a name, and notes values it leaves out", () => {
    expect(rows[1]?.errors).toEqual(["No name"]);
    expect(rows[2]?.errors).toEqual([]);
    expect(rows[2]?.values).toEqual({ name: "Titus", phone: "12345", branch: "umuahia branch" });
    expect(rows[2]?.notes).toHaveLength(5);
  });

  it("spots people already on the list, by name or phone, and repeats in the file", () => {
    expect(rows[3]?.duplicateOf).toBe("Ngozi Eze (row 2)");
    expect(rows[4]?.duplicateOf).toBe("Bola Ade");
  });

  it("lists the branches that will be created", () => {
    expect(newBranches(rows, [{ name: "ABA" }])).toEqual(["umuahia branch"]);
  });
});
