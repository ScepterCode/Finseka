import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Printer } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { localIso, naira } from "@/lib/format";
import { fetchReportSummary } from "@/lib/totals";
import { downloadCsv, fileSlug, toCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
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
        content:
          "Money in and out for any month or year, who is owing, and how each contribution did.",
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
  const { orgId, org } = useAuth();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [month, setMonth] = useState("all");

  const from =
    month === "all" ? `${year}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, "0")}-01`;
  const to =
    month === "all" ? `${year}-12-31` : localIso(new Date(Number(year), Number(month) + 1, 0));

  const report = useQuery({
    queryKey: ["reports", orgId, from, to],
    enabled: !!orgId,
    queryFn: async () => {
      const r = await fetchReportSummary(from, to);
      return {
        income: r.income,
        expense: r.expense,
        cashIn: r.cash_in,
        transferIn: r.transfer_in,
        cashOut: r.cash_out,
        transferOut: r.transfer_out,
        byLabel: r.by_label.map(
          (l) => [l.label, { income: l.income, expense: l.expense }] as const,
        ),
        defaulters: r.defaulters,
        reconciliation: r.contributions.map((c) => ({
          id: c.id,
          name: c.name,
          closed: c.closed,
          people: c.picked,
          paidPeople: c.paid_people,
          collected: c.collected,
          target: c.target,
        })),
      };
    },
  });

  const periodLabel = month === "all" ? `Year ${year}` : `${monthNames[Number(month)]} ${year}`;

  // One CSV with all three reports, one after the other.
  function exportCsv() {
    const d = report.data;
    if (!d) return;
    const statement = toCsv(d.byLabel, [
      { header: "What", value: ([label]) => label },
      { header: "Money in (₦)", value: ([, row]) => row.income },
      { header: "Money out (₦)", value: ([, row]) => row.expense },
    ]);
    const owing = toCsv(d.defaulters, [
      { header: "Member", value: (m) => m.name },
      { header: "Owing now (₦)", value: (m) => m.owing },
    ]);
    const contributions = toCsv(d.reconciliation, [
      { header: "Contribution", value: (c) => c.name },
      { header: "Closed", value: (c) => (c.closed ? "Yes" : "No") },
      { header: "People paid", value: (c) => `${c.paidPeople} of ${c.people}` },
      { header: "Collected (₦)", value: (c) => c.collected },
      { header: "Target (₦)", value: (c) => c.target },
    ]);
    const title = `${org?.name ?? "FinSeka"} — report for ${periodLabel}`;
    downloadCsv(
      `${fileSlug(org?.name ?? "finseka")}-report-${fileSlug(periodLabel)}.csv`,
      [
        `${title}\r\n`,
        `Money in and out (${periodLabel})\r\n`,
        statement,
        `\r\nWho is owing now\r\n`,
        owing,
        `\r\nContributions\r\n`,
        contributions,
      ].join(""),
    );
  }

  return (
    <div className="space-y-8">
      <div className="hidden print:block">
        <p className="font-display text-2xl font-semibold">{org?.name ?? "FinSeka"}</p>
        <p className="text-sm">
          Report for {periodLabel} · printed {new Date().toLocaleDateString("en-NG")}
        </p>
      </div>
      <PageHeader
        title="Reports"
        subtitle="Numbers you can read out at a meeting — no accounting words."
        action={
          <div className="print-hide flex flex-wrap items-end gap-3">
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
            <StatCard
              label="Money in"
              value={naira(report.data.income)}
              tone="good"
              hint={periodLabel}
            />
            <StatCard
              label="Money out"
              value={naira(report.data.expense)}
              tone="bad"
              hint={periodLabel}
            />
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
              <TabsTrigger value="defaulters">
                Who is owing ({report.data.defaulters.length})
              </TabsTrigger>
              <TabsTrigger value="contributions">Contributions</TabsTrigger>
            </TabsList>
            <div className="print-hide mt-3 flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={() => window.print()}>
                <Printer className="size-4" /> Print
              </Button>
              <Button variant="outline" className="gap-2" onClick={exportCsv}>
                <Download className="size-4" /> Download CSV
              </Button>
            </div>

            <TabsContent
              value="statement"
              forceMount
              className="mt-5 space-y-6 data-[state=inactive]:hidden print:mt-8"
            >
              <h2 className="mb-3 hidden font-display text-lg font-semibold print:block">
                Money in and out
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
                  <h3 className="font-display text-base font-semibold">Money in</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Cash:{" "}
                    <span className="font-semibold text-foreground">
                      {naira(report.data.cashIn)}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Bank transfer:{" "}
                    <span className="font-semibold text-foreground">
                      {naira(report.data.transferIn)}
                    </span>
                  </p>
                </div>
                <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
                  <h3 className="font-display text-base font-semibold">Money out</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Cash:{" "}
                    <span className="font-semibold text-foreground">
                      {naira(report.data.cashOut)}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Bank transfer:{" "}
                    <span className="font-semibold text-foreground">
                      {naira(report.data.transferOut)}
                    </span>
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

            <TabsContent
              value="defaulters"
              forceMount
              className="mt-5 data-[state=inactive]:hidden print:mt-8"
            >
              <h2 className="mb-3 hidden font-display text-lg font-semibold print:block">
                Who is owing
              </h2>
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

            <TabsContent
              value="contributions"
              forceMount
              className="mt-5 data-[state=inactive]:hidden print:mt-8"
            >
              <h2 className="mb-3 hidden font-display text-lg font-semibold print:block">
                Contributions
              </h2>
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
                          <td className="px-5 py-3 text-right text-success">
                            {naira(c.collected)}
                          </td>
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
