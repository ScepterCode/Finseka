import { naira } from "@/lib/format";

// Turns one audit_log row into a plain sentence for the History page, e.g.
// "cancelled a dues payment of ₦400 for Bola — Recorded for the wrong member".

/** A logged row: the fields the history sentences use, plus whatever else the table has. */
type Row = {
  amount?: number;
  member_id?: string;
  contribution_id?: string;
  user_id?: string;
  voided_at?: string | null;
  void_reason?: string | null;
  period_label?: string;
  name?: string;
  description?: string | null;
  label?: string;
  kind?: string;
  role?: string;
  reverses_id?: string | null;
  expenses_posted?: boolean;
  [key: string]: unknown;
};
export type Entry = {
  id: number;
  actor_id: string | null;
  table_name: string;
  action: string;
  old_row: Row | null;
  new_row: Row | null;
  at: string;
};

const fieldNames: Record<string, string> = {
  name: "name",
  phone: "phone",
  branch_id: "branch",
  active: "active status",
  tags: "labels",
  notes: "notes",
  penalty_amount: "late charge",
  penalty_grace_days: "grace days",
  reason: "reason",
  due_date: "due date",
  budget_amount: "budget",
  target_amount: "target",
  closed: "open / closed",
  committee: "committee",
  logo_url: "logo",
  role: "role",
};

function changedFields(oldRow: Row | null, newRow: Row | null) {
  if (!oldRow || !newRow) return [];
  return Object.keys(fieldNames).filter(
    (k) => k in newRow && JSON.stringify(oldRow[k]) !== JSON.stringify(newRow[k]),
  );
}

export function describeChange(e: Entry, names: Map<string, string>) {
  const row = (e.new_row ?? e.old_row ?? {}) as Row;
  const nameOf = (id: unknown) => (typeof id === "string" ? names.get(id) : undefined);
  const amount = naira(row.amount as number);
  const member = nameOf(row.member_id) ?? "a member";
  const fields = changedFields(e.old_row, e.new_row).map((k) => fieldNames[k]);
  const edited = fields.length ? `: changed ${fields.join(", ")}` : "";
  const cancelled =
    e.action === "update" && e.new_row?.voided_at && !e.old_row?.voided_at
      ? ` — ${String(e.new_row?.void_reason ?? "")}`
      : null;

  switch (e.table_name) {
    case "due_payments":
      if (cancelled !== null)
        return `cancelled a dues payment of ${amount} for ${member}${cancelled}`;
      return `recorded a dues payment of ${amount} for ${member} (${String(row.period_label ?? "")})`;
    case "contribution_payments":
      if (cancelled !== null)
        return `cancelled a payment of ${amount} for ${member} towards ${nameOf(row.contribution_id) ?? "a contribution"}${cancelled}`;
      return `recorded a payment of ${amount} for ${member} towards ${nameOf(row.contribution_id) ?? "a contribution"}`;
    case "members":
      if (e.action === "insert") return `added member ${String(row.name)}`;
      return `edited member ${String(row.name)}${edited}`;
    case "dues":
      if (e.action === "insert") return `created the due ${String(row.name)} (${amount})`;
      return `edited the due ${String(row.name)}${edited}`;
    case "contributions":
      if (e.action === "insert") return `created the contribution ${String(row.name)}`;
      if (e.new_row?.expenses_posted && !e.old_row?.expenses_posted)
        return `closed ${String(row.name)} and posted its spending to the ledger`;
      return `edited the contribution ${String(row.name)}${edited}`;
    case "contribution_members":
      return e.action === "insert"
        ? `added ${member} to ${nameOf(row.contribution_id) ?? "a contribution"}`
        : `removed ${member} from ${nameOf(row.contribution_id) ?? "a contribution"}`;
    case "contribution_expenses":
      return e.action === "delete"
        ? `removed spending "${String(row.description)}" (${amount})`
        : `added spending "${String(row.description)}" (${amount})`;
    case "ledger_entries":
      if (row.reverses_id) return `reversed a ledger line — ${String(row.description ?? "")}`;
      return `added to the ledger: ${String(row.description || row.label)} (${
        row.kind === "expense" ? "out" : "in"
      } ${amount})`;
    case "branches":
      return e.action === "insert"
        ? `added the branch ${String(row.name)}`
        : `renamed a branch to ${String(row.name)}`;
    case "organizations":
      return e.action === "insert"
        ? "created the organization"
        : `changed the organization${edited}`;
    case "user_roles":
      if (e.action === "insert")
        return `gave ${nameOf(row.user_id) ?? "someone"} ${String(row.role)} access`;
      if (e.action === "delete") return `removed ${nameOf(row.user_id) ?? "someone"}'s access`;
      return `changed ${nameOf(row.user_id) ?? "someone"}'s role${edited}`;
    default:
      return `${e.action}d a ${e.table_name.replace(/_/g, " ")} record`;
  }
}
