import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { naira } from "@/lib/format";
import { currentPeriod, type Frequency } from "@/lib/periods";
import { EmptyState, PageHeader, StatCard } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — FinSeka" },
      {
        name: "description",
        content: "Money in and out for any month or year, who is owing, and how each contribution did.",
      },
      { property: "og:title", content: "Reports — FinSeka" },
      { property: "og:description", content: "Simple reports you can read out at a meeting." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportsPage,
});

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ReportsPage() {
  const { orgId } = useAuth();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [month, setMonth] = useState("all");

  const from = month === "all" ? `${year}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, "0")}-01`;
  const to =
    month === "all"
      ? `${year}-12-31`
      : new Date(Number(year), Number(month) + 1, 0).toISOString().slice(0, 10);

  const report = useQuery({
    queryKey: ["reports", orgId, from, to],
    enabled: !!orgId,
    queryFn: async () => {
      const [ledger, members, dues, duePayments, contributions, cMembers, cPayments] =
        await Promise.all([
          supabase
            .from("ledger_entries")
            .select("kind, label, amount, method, entry_date")
            .gte("entry_date", from)
            .lte("entry_date", to),
          supabase.from("members").select("id, name").eq("active", true).order("name"),
          supabase.from("dues").select("id, name, amount, frequency, penalty_amount").eq("active", true),
          supabase.from("due_payments").select("due_id, member_id, amount, period_label"),
          supabase.from("contributions").select("id, name, amount_per_person, target_amount, closed"),
          supabase.from("contribution_members").select("contribution_id, member_id"),
          supabase.from("contribution_payments").select("contribution_id, member_id, amount"),
        ]);

      const entries = ledger.data ?? [];
      const sum = (kind: string, method?: string) =>
        entries
          .filter((e) => e.kind === kind && (!method || e.method === method))
          .reduce((s, e) => s + Number(e.amount), 0);

      const byLabel = new Map<string, { income: number; expense: number }>();
      for (const e of entries) {
        const row = byLabel.get(e.label) ?? { income: 0, expense: 0 };
        if (e.kind === "income") row.income += Number(e.amount);
        else row.expense += Number(e.amount);
        byLabel.set(e.label, row);
      }

      const owingByMember = new Map<string, number>();
      const addOwing = (memberId: string, amount: number) =>
        owingByMember.set(memberId, (owingByMember.get(memberId) ?? 0) + amount);

      for (const due of dues.data ?? []) {
        const period = currentPeriod(due.frequency as Frequency);
        for (const m of members.data ?? []) {
          const paid = (duePayments.data ?? [])
            .filter((p) => p.due_id === due.id && p.member_id === m.id && p.period_label === period)
            .reduce((s, p) => s + Number(p.amount), 0);
          const short = Math.max(0, Number(due.amount) - paid);
          if (short > 0) addOwing(m.id, short);
        }
      }

      const reconciliation = (contributions.data ?? []).map((c) => {
        const picked = (cMembers.data ?? []).filter((r) => r.contribution_id === c.id);
        const paidRows = (cPayments.data ?? []).filter((p) => p.contribution_id === c.id);
        const collected = paidRows.reduce((s, p) => s + Number(p.amount), 0);
        const target = Number(c.target_amount ?? 0) || picked.length * Number(c.amount_per_person);
        for (const p of picked) {
          const paid = paidRows
            .filter((r) => r.member_id === p.member_id)
            .reduce((s, r) => s + Number(r.amount), 0);
          const short = Math.max(0, Number(c.amount_per_person) - paid);
          if (short > 0) addOwing(p.member_id, short);
        }
        return {
          id: c.id,
          name: c.name,
          closed: c.closed,
          people: picked.length,
          paidPeople: new Set(paidRows.map((r) => r.member_id)).size,
          collected,
          target,
        };
      });

      return {
        income: sum("income"),
        expense: sum("expense"),
        cashIn: sum("income", "cash"),
        transferIn: sum("income", "transfer"),
        cashOut: sum("expense", "cash"),
        transferOut: sum("expense", "transfer"),
        byLabel: [...byLabel.entries()].sort((a, b) => b[1].income - a[1].income),
        defaulters: (members.data ?? [])
          .map((m) => ({ ...m, owing: owingByMember.get(m.id) ?? 0 }))
          .filter((m) => m.owing > 0)
          .sort((a, b) => b.owing - a.owing),
        reconciliation,
      };
    },
  });

  const periodLabel = month === "all" ? `Year ${year}` : `${monthNames[Number(month)]} ${year}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        subtitle="Numbers you can read out at a meeting — no accounting words."
        action={
          <div className="flex gap-3">
            <div className="w-32">
              <Label className="mb-1.5 block text-xs">Year</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <SelectItem key={i} value={String(thisYear - i)}>
                      {thisYear - i}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label className="mb-1.5 block text-xs">Month</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Whole year</SelectItem>
                  {monthNames.map((m, i) => (
                    <SelectItem key={m} value={String(i)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        }
      />

      {report.isLoading || !report.data ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Money in" value={naira(report.data.income)} tone="good" hint={periodLabel} />
            <StatCard label="Money out" value={naira(report.data.expense)} tone="bad" hint={periodLabel} />
            <StatCard
              label="What is left"
              value={naira(report.data.income - report.data.expense)}
              tone="accent"
              hint={periodLabel}
            />
          </div>

          <Tabs defaultValue="statement">
            <TabsList className="flex-wrap">
              <TabsTrigger value="statement">Money in and out</TabsTrigger>
              <TabsTrigger value="defaulters">Who is owing ({report.data.defaulters.length})</TabsTrigger>
              <TabsTrigger value="contributions">Contributions</TabsTrigger>
            </TabsList>

            <TabsContent value="statement" className="mt-5 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
                  <h3 className="font-display text-base font-semibold">Money in</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Cash: <span className="font-semibold text-foreground">{naira(report.data.cashIn)}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Bank transfer:{" "}
                    <span className="font-semibold text-foreground">{naira(report.data.transferIn)}</span>
                  </p>
                </div>
                <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
                  <h3 className="font-display text-base font-semibold">Money out</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Cash: <span className="font-semibold text-foreground">{naira(report.data.cashOut)}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Bank transfer:{" "}
                    <span className="font-semibold text-foreground">{naira(report.data.transferOut)}</span>
                  </p>
                </div>
              </div>

              {report.data.byLabel.length === 0 ? (
                <EmptyState title="Nothing in this period" hint="Pick another month or year." />
              ) : (
                <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3">What</th>
                        <th className="px-5 py-3 text-right">In</th>
                        <th className="px-5 py-3 text-right">Out</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.data.byLabel.map(([label, row]) => (
                        <tr key={label}>
                          <td className="px-5 py-3 font-medium">{label}</td>
                          <td className="px-5 py-3 text-right text-success">
                            {row.income ? naira(row.income) : "—"}
                          </td>
                          <td className="px-5 py-3 text-right text-destructive">
                            {row.expense ? naira(row.expense) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="defaulters" className="mt-5">
              {report.data.defaulters.length === 0 ? (
                <EmptyState title="Nobody is owing" hint="Everybody is up to date. Well done." />
              ) : (
                <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3">Member</th>
                        <th className="px-5 py-3 text-right">Owing now</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.data.defaulters.map((m) => (
                        <tr key={m.id}>
                          <td className="px-5 py-3 font-medium">{m.name}</td>
                          <td className="px-5 py-3 text-right font-semibold text-destructive">
                            {naira(m.owing)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="contributions" className="mt-5">
              {report.data.reconciliation.length === 0 ? (
                <EmptyState title="No contributions yet" hint="Create one and it will show here." />
              ) : (
                <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3">Contribution</th>
                        <th className="px-5 py-3">People paid</th>
                        <th className="px-5 py-3 text-right">Collected</th>
                        <th className="px-5 py-3 text-right">Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.data.reconciliation.map((c) => (
                        <tr key={c.id}>
                          <td className="px-5 py-3 font-medium">
                            {c.name}{" "}
                            {c.closed && (
                              <Badge variant="secondary" className="ml-1">
                                Closed
                              </Badge>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {c.paidPeople}/{c.people}
                          </td>
                          <td className="px-5 py-3 text-right text-success">{naira(c.collected)}</td>
                          <td className="px-5 py-3 text-right">{naira(c.target)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
