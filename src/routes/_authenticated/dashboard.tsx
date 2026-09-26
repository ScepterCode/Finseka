import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowRight, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { naira, shortDate } from "@/lib/format";
import { fetchDashboardSummary } from "@/lib/totals";
import { PageHeader, StatCard, EmptyState } from "@/components/page-parts";
import { OpeningBalanceCard } from "@/components/opening-balance-card";
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
      const s = await fetchDashboardSummary();
      return {
        balance: s.balance,
        owed: s.owed,
        memberCount: s.member_count,
        duesPaid: s.dues_paid,
        duesUnpaid: s.dues_unpaid,
        contributions: s.contributions.map((c) => ({
          id: c.id,
          name: c.name,
          dueDate: c.due_date,
          paidCount: c.paid_people,
          selectedCount: c.picked,
          collected: c.collected,
          target: c.target,
        })),
        recent: s.recent,
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

      <OpeningBalanceCard />

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
          hint="Unpaid dues, late charges and compulsory contributions"
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
                    <Pie
                      data={pie}
                      dataKey="value"
                      innerRadius={42}
                      outerRadius={68}
                      strokeWidth={0}
                    >
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
            {data.recent.map((e) => {
              // Reversal lines carry a negative amount, so the effect on the purse is kind × amount.
              const effect = (e.kind === "income" ? 1 : -1) * Number(e.amount);
              return (
                <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.description ?? e.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.label} · {shortDate(e.entry_date)}
                    </p>
                  </div>
                  <Badge variant={effect >= 0 ? "secondary" : "outline"}>
                    <span className={effect >= 0 ? "text-success" : "text-destructive"}>
                      {effect >= 0 ? "+" : "−"}
                      {naira(Math.abs(effect))}
                    </span>
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
