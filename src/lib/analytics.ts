import { supabase } from "@/integrations/supabase/client";
import { localIso } from "@/lib/format";

// Figures for the analytics page, worked out by the database (analytics_summary).

export type AnalyticsSummary = {
  from: string;
  to: string;
  totals: { income: number; expense: number; balance: number };
  monthly: {
    month: string;
    income: number;
    expense: number;
    expected: number;
    collected: number;
  }[];
  collection: { expected: number; collected: number };
  aging: { bucket: string; amount: number; people: number }[];
  owed: number;
  per_due: { name: string; expected: number; collected: number }[];
  top_owing: { id: string; name: string; owing: number }[];
  spending: { label: string; amount: number }[];
  channels: { channel: string; income: number; expense: number }[];
  members: { active: number; never_paid: number; joined: number };
};

export async function fetchAnalytics(
  from: string,
  to: string,
  branchId: string | null,
  label: string | null,
) {
  const { data, error } = await supabase.rpc("analytics_summary", {
    _from: from,
    _to: to,
    ...(branchId ? { _branch_id: branchId } : {}),
    ...(label ? { _label: label } : {}),
  });
  if (error) throw error;
  return data as unknown as AnalyticsSummary;
}

export type RangeKey = "3" | "6" | "12" | "custom";

/** From the first day of the month `months - 1` months ago, to today. */
export function lastMonths(months: number, today = new Date()) {
  const from = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  return { from: localIso(from), to: localIso(today) };
}

/** Share of what was due that was collected, as a whole percentage; null when nothing was due. */
export function collectionRate(expected: number, collected: number): number | null {
  const e = Number(expected);
  return e > 0 ? Math.round((Number(collected) / e) * 100) : null;
}

const shortMonths = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-09-01" -> "Sep 26" for axis labels. */
export function monthTick(isoMonth: string) {
  const [y, m] = isoMonth.split("-");
  return `${shortMonths[Number(m) - 1]} ${String(y).slice(2)}`;
}

/** ₦ amounts shortened for axis ticks: 1500 -> ₦1.5k, 2400000 -> ₦2.4m. */
export function nairaShort(value: number) {
  const n = Number(value);
  const abs = Math.abs(n);
  const fmt = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (abs >= 1_000_000) return `₦${fmt(n / 1_000_000)}m`;
  if (abs >= 1_000) return `₦${fmt(n / 1_000)}k`;
  return `₦${n}`;
}
