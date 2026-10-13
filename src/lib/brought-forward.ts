import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// Debts brought forward: what a member already owed before the organization started using
// FinSeka, written in as labelled lines. They count in what the member owes but are not money
// received, so they never touch the ledger until they are paid.

export type BroughtForwardDebt = {
  id: string;
  label: string;
  amount: number;
  as_of: string;
  note: string | null;
  paid: number;
  outstanding: number;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

/** Every query that shows what members owe, refreshed after a debt changes. */
export const OWED_QUERY_KEYS = [
  "member-bf-debts",
  "member-bf-payments",
  "member-standing",
  "brought-forward-overview",
  "dashboard",
  "reports",
  "analytics",
];

export function useMemberBroughtForward(memberId: string) {
  return useQuery({
    queryKey: ["member-bf-debts", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brought_forward_status")
        .select("id, label, amount, as_of, note, paid, outstanding, cancelled_at, cancel_reason")
        .eq("member_id", memberId)
        .order("as_of")
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((d) => ({
        ...d,
        amount: Number(d.amount),
        paid: Number(d.paid),
        outstanding: Number(d.outstanding),
      })) as BroughtForwardDebt[];
    },
  });
}

/** A line being typed in: a label and an amount. */
export type DebtLine = { label: string; amount: string };

export const emptyDebtLine = (label = ""): DebtLine => ({ label, amount: "" });

/** The lines worth saving: a label and an amount above ₦0. */
export function filledDebtLines(lines: DebtLine[]) {
  return lines
    .map((l) => ({ label: l.label.trim(), amount: Number(l.amount) }))
    .filter((l) => l.label && l.amount > 0);
}
