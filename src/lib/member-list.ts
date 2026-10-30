import { matchesPerson } from "@/lib/search";

/** One row on the Members page: the member, their branch and what they owe today. */
export type MemberRow = {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  tags: string[];
  branch: string | null;
  /** From member_balances, the same total as the profile and the dashboard. null for a member
   * who is not active, since they are not charged. */
  owing: number | null;
};

export type MemberSort = "name" | "phone" | "branch" | "owing";
export type SortDir = "asc" | "desc";

export type MemberFilters = {
  search: string;
  tag: string;
  owingOnly: boolean;
};

/** Amount owed sorts biggest first on the first click; text columns sort A to Z. */
export function defaultDir(sort: MemberSort): SortDir {
  return sort === "owing" ? "desc" : "asc";
}

export function filterMembers(rows: MemberRow[], f: MemberFilters) {
  return rows.filter(
    (m) =>
      matchesPerson(f.search, m.name, m.phone) &&
      (f.tag === "all" || m.tags.includes(f.tag)) &&
      (!f.owingOnly || (m.owing ?? 0) > 0),
  );
}

const text = (v: string | null) => (v ?? "").trim();

/** Sorts a copy. Blank phones and branches always go last; ties fall back to the name. */
export function sortMembers(rows: MemberRow[], sort: MemberSort, dir: SortDir) {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: MemberRow, b: MemberRow) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return [...rows].sort((a, b) => {
    if (sort === "owing") {
      const diff = ((a.owing ?? -1) - (b.owing ?? -1)) * sign;
      return diff || byName(a, b);
    }
    if (sort === "name") return byName(a, b) * sign;
    const x = text(sort === "phone" ? a.phone : a.branch);
    const y = text(sort === "phone" ? b.phone : b.branch);
    if (!x !== !y) return x ? -1 : 1;
    return (
      x.localeCompare(y, undefined, { sensitivity: "base", numeric: true }) * sign || byName(a, b)
    );
  });
}

/** "312 members · 87 owing ₦1,240,000" — counts and totals for the rows shown. */
export function summarize(rows: MemberRow[]) {
  const owing = rows.filter((m) => (m.owing ?? 0) > 0);
  return {
    members: rows.length,
    owing: owing.length,
    total: owing.reduce((s, m) => s + (m.owing ?? 0), 0),
  };
}
