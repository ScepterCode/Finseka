import type { StandingLine } from "@/lib/totals";
import { naira, shortDate } from "@/lib/format";
import { paymentModeText } from "@/lib/methods";

// A member statement: everything they were charged and everything they paid towards it,
// in date order with a running balance. Freewill gifts are left out (nobody owed them);
// they still appear in the member's payment history.

export type StatementEntry = {
  date: string;
  text: string;
  charged: number;
  paid: number;
  balance: number;
};

type DuePayment = {
  due_id: string;
  amount: number | string;
  paid_at: string;
  period_label: string;
  channel?: string | null;
  reference?: string | null;
  method?: string | null;
  voided_at?: string | null;
  dues?: { name: string } | null;
};

type ContributionPayment = {
  contribution_id: string;
  amount: number | string;
  paid_at: string;
  channel?: string | null;
  reference?: string | null;
  method?: string | null;
  voided_at?: string | null;
  contributions?: { name: string } | null;
};

export function buildStatement(
  lines: StandingLine[],
  duePayments: DuePayment[],
  contributionPayments: ContributionPayment[],
): StatementEntry[] {
  type Row = Omit<StatementEntry, "balance"> & { order: number };
  const rows: Row[] = [];

  for (const l of lines) {
    const date = l.period_start ?? "";
    if (l.kind === "due") {
      rows.push({
        date,
        text: `${l.ref_name} — ${l.period_label}`,
        charged: l.expected,
        paid: 0,
        order: 0,
      });
      if (l.penalty > 0) {
        rows.push({
          date: l.period_end ?? date,
          text: `Late charge — ${l.ref_name} (${l.period_label})`,
          charged: l.penalty,
          paid: 0,
          order: 0,
        });
      }
    } else {
      rows.push({ date, text: l.ref_name, charged: l.expected, paid: 0, order: 0 });
    }
  }

  const charged = new Set(lines.filter((l) => l.kind === "contribution").map((l) => l.ref_id));

  for (const p of duePayments) {
    if (p.voided_at) continue;
    rows.push({
      date: p.paid_at,
      text: `Paid ${p.dues?.name ?? "dues"} (${p.period_label}) · ${paymentModeText(p.channel, p.reference, p.method)}`,
      charged: 0,
      paid: Number(p.amount),
      order: 1,
    });
  }
  for (const p of contributionPayments) {
    if (p.voided_at || !charged.has(p.contribution_id)) continue;
    rows.push({
      date: p.paid_at,
      text: `Paid ${p.contributions?.name ?? "contribution"} · ${paymentModeText(p.channel, p.reference, p.method)}`,
      charged: 0,
      paid: Number(p.amount),
      order: 1,
    });
  }

  // Oldest first; on the same day, charges before payments.
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let balance = 0;
  return rows.map(({ order: _order, ...r }) => {
    balance += r.charged - r.paid;
    return { ...r, balance };
  });
}

/** A short statement to paste into WhatsApp. */
export function statementMessage(opts: {
  memberName: string;
  orgName: string;
  owing: number;
  entries: StatementEntry[];
}) {
  const unpaid = opts.entries.filter((e) => e.charged > 0).slice(-6);
  const lines = [
    `${opts.orgName} — statement for ${opts.memberName}`,
    `As of ${shortDate(new Date())}: owing ${naira(opts.owing)}`,
  ];
  if (opts.owing > 0 && unpaid.length) {
    lines.push("", "Recent charges:", ...unpaid.map((e) => `• ${e.text}: ${naira(e.charged)}`));
  }
  lines.push("", "Thank you!");
  return lines.join("\n");
}
