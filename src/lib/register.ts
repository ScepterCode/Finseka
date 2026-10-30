/**
 * Payment registers: who was expected to pay a due period or a contribution, what they paid and
 * what they still owe. Shared by the due and contribution pages so both sort and count the same way.
 */

/** "gave" is a payment towards a contribution with no set amount. */
export type PayStatus = "paid" | "part" | "unpaid" | "gave";
export type RegisterFilter = "all" | "paid" | "part" | "unpaid";
export type RegisterSort = "name" | "status" | "paid" | "owing" | "date";
export type SortDir = "asc" | "desc";

export type RegisterRow = {
  name: string;
  status: PayStatus;
  paid: number;
  owing: number;
  /** The latest payment date (YYYY-MM-DD), or null if nothing was paid. */
  date: string | null;
};

/** The status of someone expected to pay `expected` who has paid `paid`. With no set amount,
 * anything paid counts as having given. */
export function payStatus(paid: number, expected: number, fixedAmount = true): PayStatus {
  if (!fixedAmount) return paid > 0 ? "gave" : "unpaid";
  if (expected > 0 && paid >= expected) return "paid";
  return paid > 0 ? "part" : "unpaid";
}

export function matchesFilter(status: PayStatus, filter: RegisterFilter) {
  if (filter === "all") return true;
  if (filter === "paid") return status === "paid" || status === "gave";
  return status === filter;
}

export function countByFilter(rows: { status: PayStatus }[]): Record<RegisterFilter, number> {
  const counts = { all: rows.length, paid: 0, part: 0, unpaid: 0 };
  for (const r of rows) counts[r.status === "gave" ? "paid" : r.status] += 1;
  return counts;
}

// Not paid first, then part paid, then paid: the order an admin works through.
const STATUS_ORDER: Record<PayStatus, number> = { unpaid: 0, part: 1, paid: 2, gave: 2 };

/** Money and dates sort biggest or latest first on the first click; name and status A to Z. */
export function defaultDir(sort: RegisterSort): SortDir {
  return sort === "name" || sort === "status" ? "asc" : "desc";
}

/** Sorts a copy. People who never paid go last when sorting by date; ties fall back to the name. */
export function sortRegister<T extends RegisterRow>(rows: T[], sort: RegisterSort, dir: SortDir) {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return [...rows].sort((a, b) => {
    let diff: number;
    if (sort === "name") return byName(a, b) * sign;
    if (sort === "status") diff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    else if (sort === "paid") diff = a.paid - b.paid;
    else if (sort === "owing") diff = a.owing - b.owing;
    else {
      if (!a.date !== !b.date) return a.date ? -1 : 1;
      diff = (a.date ?? "").localeCompare(b.date ?? "");
    }
    return diff * sign || byName(a, b);
  });
}
