import { describe, expect, it } from "vitest";

import { audienceIsValid, describeAudience, everyone } from "./audience";

describe("who pays a due", () => {
  it("describes each choice in plain words", () => {
    expect(describeAudience({ audience: "everyone" })).toBe("Everyone");
    expect(describeAudience({ audience: "labels", audience_labels: ["new", "youth"] })).toBe(
      "Members labelled new, youth",
    );
    expect(
      describeAudience(
        { audience: "branches", audience_branch_ids: ["b1"] },
        new Map([["b1", "Aba Branch"]]),
      ),
    ).toBe("Members in Aba Branch");
    expect(describeAudience({ audience: "people" })).toBe("Specific people");
  });

  it("needs at least one label, branch or person", () => {
    expect(audienceIsValid(everyone)).toBe(true);
    expect(audienceIsValid({ ...everyone, audience: "labels" })).toBe(false);
    expect(audienceIsValid({ ...everyone, audience: "labels", labels: ["new"] })).toBe(true);
    expect(audienceIsValid({ ...everyone, audience: "people" })).toBe(false);
  });
});
