/** One thing a member owes: a due period, a compulsory contribution or a debt brought forward. */
export type Debt =
  | {
      kind: "due";
      dueId: string;
      periodStart: string;
      periodLabel: string;
      title: string;
      owing: number;
      /** Late charge on this period; it clears once the period is paid in full. */
      penalty: number;
    }
  | { kind: "contribution"; contributionId: string; title: string; owing: number }
  | { kind: "brought_forward"; debtId: string; title: string; owing: number };

/** "auto" spreads the payment over the oldest debts first. */
export const AUTO = "auto";

export function debtKey(d: Debt) {
  if (d.kind === "due") return `due:${d.dueId}:${d.periodStart}`;
  if (d.kind === "brought_forward") return `brought_forward:${d.debtId}`;
  return `contribution:${d.contributionId}`;
}
