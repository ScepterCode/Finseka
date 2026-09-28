import { describe, expect, it } from "vitest";

import { matchesPerson } from "./search";

describe("matchesPerson", () => {
  it("matches everyone when the search is empty", () => {
    expect(matchesPerson("", "Ada Obi")).toBe(true);
    expect(matchesPerson("   ", "Ada Obi")).toBe(true);
  });

  it("ignores capitals and matches parts of the name in any order", () => {
    expect(matchesPerson("ADA", "Ada Chioma Obi")).toBe(true);
    expect(matchesPerson("obi ada", "Ada Chioma Obi")).toBe(true);
    expect(matchesPerson("chi", "Ada Chioma Obi")).toBe(true);
    expect(matchesPerson("ada okeke", "Ada Chioma Obi")).toBe(false);
  });

  it("finds people by phone however the number is written", () => {
    const phone = "0803 123 4567";
    expect(matchesPerson("08031234567", "Titus", phone)).toBe(true);
    expect(matchesPerson("+234 803 123", "Titus", phone)).toBe(true);
    expect(matchesPerson("4567", "Titus", phone)).toBe(true);
    expect(matchesPerson("9999", "Titus", phone)).toBe(false);
  });

  it("does not match phones on one or two digits", () => {
    expect(matchesPerson("08", "Titus", "0803 123 4567")).toBe(false);
  });

  it("copes with people who have no phone", () => {
    expect(matchesPerson("0803", "Titus", null)).toBe(false);
  });
});
