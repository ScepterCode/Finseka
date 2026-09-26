import { describe, expect, it } from "vitest";

import { fetchAll, PAGE } from "./fetch-all";

// A fake table of n rows served the way Supabase does, at most PAGE rows per request.
function table(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + PAGE)), error: null });
  };
  return { page, calls };
}

describe("fetchAll", () => {
  it("gets everything past the 1,000-row limit", async () => {
    const t = table(2345);
    const all = await fetchAll(t.page);
    expect(all).toHaveLength(2345);
    expect(all.at(-1)).toEqual({ id: 2344 });
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops after one request for small lists", async () => {
    const t = table(12);
    expect(await fetchAll(t.page)).toHaveLength(12);
    expect(t.calls).toHaveLength(1);
  });

  it("asks once more when the list is an exact multiple of the page size", async () => {
    const t = table(1000);
    expect(await fetchAll(t.page)).toHaveLength(1000);
    expect(t.calls).toHaveLength(2);
  });

  it("passes errors on", async () => {
    await expect(
      fetchAll(() => Promise.resolve({ data: null, error: new Error("boom") })),
    ).rejects.toThrow("boom");
  });
});
