import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { naira } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "History — FinSeka" },
      {
        name: "description",
        content: "Every change made to your organization's records, and who made it.",
      },
      { property: "og:title", content: "History — FinSeka" },
      { property: "og:description", content: "Who changed what, and when." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HistoryPage,
});

const PAGE_SIZE = 50;

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
type Entry = {
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

function describe(e: Entry, names: Map<string, string>) {
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

function HistoryPage() {
  const { orgId } = useAuth();

  // Names for people, members, dues and contributions mentioned in the log.
  const names = useQuery({
    queryKey: ["history-names", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [people, members, dues, contributions] = await Promise.all([
        supabase.from("profiles").select("id, full_name"),
        supabase.from("members").select("id, name"),
        supabase.from("dues").select("id, name"),
        supabase.from("contributions").select("id, name"),
      ]);
      const map = new Map<string, string>();
      for (const p of people.data ?? []) map.set(p.id, p.full_name || "A team member");
      for (const r of [
        ...(members.data ?? []),
        ...(dues.data ?? []),
        ...(contributions.data ?? []),
      ])
        map.set(r.id, r.name);
      return map;
    },
  });

  const log = useInfiniteQuery({
    queryKey: ["history", orgId],
    enabled: !!orgId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, actor_id, table_name, action, old_row, new_row, at")
        .order("at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);
      if (error) throw error;
      return data as Entry[];
    },
    getNextPageParam: (last, pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });

  const rows = log.data?.pages.flat() ?? [];
  const nameMap = names.data ?? new Map<string, string>();

  return (
    <div className="space-y-8">
      <PageHeader
        title="History"
        subtitle="Every change to your records, who made it and when. Nothing here can be edited or removed."
      />

      {log.isLoading || names.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing yet" hint="Changes will show here as your team uses FinSeka." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {rows.map((e) => (
            <li key={e.id} className="flex items-start gap-4 px-5 py-4">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
                <History className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">
                  <span className="font-semibold">
                    {e.actor_id ? (nameMap.get(e.actor_id) ?? "A former team member") : "FinSeka"}
                  </span>{" "}
                  {describe(e, nameMap)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {log.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void log.fetchNextPage()}
            disabled={log.isFetchingNextPage}
          >
            {log.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />} Show more
          </Button>
        </div>
      )}
    </div>
  );
}
