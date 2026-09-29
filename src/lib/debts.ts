/** One thing a member owes: a due period or a compulsory contribution. */
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
  | { kind: "contribution"; contributionId: string; title: string; owing: number };

/** "auto" spreads the payment over the oldest debts first. */
export const AUTO = "auto";

export function debtKey(d: Debt) {
  return d.kind === "due" ? `due:${d.dueId}:${d.periodStart}` : `contribution:${d.contributionId}`;
}
