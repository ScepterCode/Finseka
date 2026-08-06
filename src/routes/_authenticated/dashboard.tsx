import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowRight, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { naira, shortDate } from "@/lib/format";
import { currentPeriod, type Frequency } from "@/lib/periods";
import { PageHeader, StatCard, EmptyState } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — FinSeka" },
      { name: "description", content: "Balance in hand, money being owed and dues health." },
      { property: "og:title", content: "Dashboard — FinSeka" },
      { property: "og:description", content: "Your association money at a glance." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { orgId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [ledger, members, dues, duePayments, contributions, cMembers, cPayments] =
        await Promise.all([
          supabase.from("ledger_entries").select("id, kind, label, description, amount, entry_date"),
          supabase.from("members").select("id").eq("active", true),
          supabase.from("dues").select("id, name, amount, frequency").eq("active", true),
          supabase.from("due_payments").select("due_id, member_id, amount, period_label"),
          supabase
            .from("contributions")
            .select("id, name, amount_per_person, target_amount, due_date, closed")
            .eq("closed", false),
          supabase.from("contribution_members").select("contribution_id, member_id"),
          supabase.from("contribution_payments").select("contribution_id, member_id, amount"),
        ]);

      const entries = ledger.data ?? [];
      const income = entries
        .filter((e) => e.kind === "income")
        .reduce((s, e) => s + Number(e.amount), 0);
      const expense = entries
        .filter((e) => e.kind === "expense")
        .reduce((s, e) => s + Number(e.amount), 0);

      const memberCount = members.data?.length ?? 0;
      const payments = duePayments.data ?? [];

      let owed = 0;
      let paidThisPeriod = 0;
      let expectedThisPeriod = 0;

      for (const due of dues.data ?? []) {
        const period = currentPeriod(due.frequency as Frequency);
        const forPeriod = payments.filter(
          (p) => p.due_id === due.id && p.period_label === period,
        );
        const expected = memberCount * Number(due.amount);
        const paid = forPeriod.reduce((s, p) => s + Number(p.amount), 0);
        owed += Math.max(0, expected - paid);
        expectedThisPeriod += memberCount;
        paidThisPeriod += forPeriod.length;
      }

      const openContributions = (contributions.data ?? []).map((c) => {
        const selected = (cMembers.data ?? []).filter((m) => m.contribution_id === c.id);
        const paidRows = (cPayments.data ?? []).filter((p) => p.contribution_id === c.id);
        const collected = paidRows.reduce((s, p) => s + Number(p.amount), 0);
        const target =
          Number(c.target_amount ?? 0) || selected.length * Number(c.amount_per_person);
        owed += Math.max(0, target - collected);
        return {
          id: c.id,
          name: c.name,
          dueDate: c.due_date,
          paidCount: paidRows.length,
          selectedCount: selected.length,
          collected,
          target,
        };
      });

      return {
        balance: income - expense,
        owed,
        memberCount,
        duesPaid: paidThisPeriod,
        duesUnpaid: Math.max(0, expectedThisPeriod - paidThisPeriod),
        contributions: openContributions,
        recent: entries
          .slice()
          .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))
          .slice(0, 6),
      };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const pie = [
    { name: "Paid", value: data.duesPaid, color: "var(--success)" },
    { name: "Not paid", value: data.duesUnpaid, color: "var(--destructive)" },
  ];
  const hasDuesData = data.duesPaid + data.duesUnpaid > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="Everything at a glance — money in hand, money being owed."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Balance in hand"
          value={naira(data.balance)}
          hint="Money in the organization purse"
        />
        <StatCard
          label="Total being owed"
          value={naira(data.owed)}
          tone="bad"
          hint="Unpaid dues and contributions"
        />
        <StatCard
          label="Members"
          value={String(data.memberCount)}
          tone="accent"
          hint="People on your list"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
          <h2 className="font-display text-lg font-semibold">Dues health (this period)</h2>
          {hasDuesData ? (
            <div className="mt-4 flex items-center gap-6">
              <div className="h-40 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pie} dataKey="value" innerRadius={42} outerRadius={68} strokeWidth={0}>
                      {pie.map((slice) => (
                        <Cell key={slice.name} fill={slice.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2">
                  <span className="size-3 rounded-full bg-success" />
                  <span className="font-semibold">{data.duesPaid}</span> paid
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-3 rounded-full bg-destructive" />
                  <span className="font-semibold">{data.duesUnpaid}</span> not paid
                </li>
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Set your dues and add members to see this.
            </p>
          )}
          <Button asChild variant="ghost" size="sm" className="mt-4 gap-2 px-0">
            <Link to="/dues">
              Go to Dues <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
          <h2 className="font-display text-lg font-semibold">Active contributions</h2>
          {data.contributions.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Nothing running now. Create one when something comes up.
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {data.contributions.slice(0, 3).map((c) => (
                <li key={c.id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <Link
                      to="/contributions/$contributionId"
                      params={{ contributionId: c.id }}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {c.paidCount}/{c.selectedCount} people paid
                    </span>
                  </div>
                  <Progress
                    className="mt-2"
                    value={c.target ? Math.min(100, (c.collected / c.target) * 100) : 0}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {naira(c.collected)} of {naira(c.target)}
                    {c.dueDate ? ` · due ${shortDate(c.dueDate)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="ghost" size="sm" className="mt-4 gap-2 px-0">
            <Link to="/contributions">
              Go to Contributions <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-display text-lg font-semibold">Recent activity</h2>
        {data.recent.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            hint="Once you mark payments or add expenses, they will show here."
          />
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {data.recent.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.description ?? e.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.label} · {shortDate(e.entry_date)}
                  </p>
                </div>
                <Badge variant={e.kind === "income" ? "secondary" : "outline"}>
                  <span className={e.kind === "income" ? "text-success" : "text-destructive"}>
                    {e.kind === "income" ? "+" : "−"}
                    {naira(e.amount)}
                  </span>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
