import { supabase } from "@/integrations/supabase/client";

// Money totals are worked out in the database, including which periods each member owes
// for (see supabase/migrations/*_db_totals.sql and *_periods_as_dates.sql), so every page
// uses the same rules and nothing is cut off at 1,000 rows.

export type LedgerTotals = {
  income: number;
  expense: number;
  balance: number;
  cash_in: number;
  transfer_in: number;
  cash_out: number;
  transfer_out: number;
  cash: number;
  bank: number;
};

export type ContributionProgress = {
  id: string;
  name: string;
  closed: boolean;
  due_date: string | null;
  picked: number;
  paid_people: number;
  collected: number;
  target: number;
};

export type DashboardSummary = LedgerTotals & {
  owed: number;
  member_count: number;
  dues_paid: number;
  dues_unpaid: number;
  contributions: ContributionProgress[];
  recent: {
    id: string;
    kind: "income" | "expense";
    label: string;
    description: string | null;
    amount: number;
    entry_date: string;
  }[];
};

export type ReportSummary = LedgerTotals & {
  by_label: { label: string; income: number; expense: number }[];
  defaulters: { id: string; name: string; owing: number }[];
  contributions: ContributionProgress[];
};

export type StandingLine = {
  kind: "due" | "contribution";
  member_id: string;
  ref_id: string;
  ref_name: string;
  period_label: string | null;
  is_current: boolean;
  is_past: boolean;
  expected: number;
  paid: number;
  short: number;
  penalty: number;
  period_start: string | null;
  period_end: string | null;
};

export async function fetchLedgerTotals(from?: string, to?: string) {
  const { data, error } = await supabase.rpc("ledger_totals", {
    ...(from ? { _from: from } : {}),
    ...(to ? { _to: to } : {}),
  });
  if (error) throw error;
  return data as unknown as LedgerTotals;
}

export async function fetchDashboardSummary() {
  const { data, error } = await supabase.rpc("dashboard_summary");
  if (error) throw error;
  return data as unknown as DashboardSummary;
}

export async function fetchReportSummary(from: string, to: string) {
  const { data, error } = await supabase.rpc("report_summary", { _from: from, _to: to });
  if (error) throw error;
  return data as unknown as ReportSummary;
}

/** Every due period and compulsory contribution for one member, with what they still owe. */
export async function fetchMemberStanding(memberId: string) {
  const { data, error } = await supabase.rpc("standing_lines", { _member_id: memberId });
  if (error) throw error;
  return (data ?? []).map((l) => ({
    ...l,
    expected: Number(l.expected),
    paid: Number(l.paid),
    short: Number(l.short),
    penalty: Number(l.penalty),
  })) as StandingLine[];
}

export async function fetchContributionProgress(openOnly = false) {
  const { data, error } = await supabase.rpc("contribution_progress", { _open_only: openOnly });
  if (error) throw error;
  return (data ?? []) as unknown as ContributionProgress[];
}
