import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { naira, todayIso } from "@/lib/format";
import { channelLabel } from "@/lib/methods";
import { collectionRate, fetchAnalytics, lastMonths, type RangeKey } from "@/lib/analytics";
import { useAudienceOptions } from "@/lib/audience";
import { AgingChart, CollectionRateChart, MoneyByMonthChart } from "@/components/analytics-charts";
import { PageHeader, StatCard } from "@/components/page-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — FinSeka" },
      {
        name: "description",
        content: "Trends in money in and out, how well dues are collected, and who is owing.",
      },
      { property: "og:title", content: "Analytics — FinSeka" },
      { property: "og:description", content: "Trends and patterns in your association money." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalyticsPage,
});

const ranges: { key: RangeKey; label: string }[] = [
  { key: "3", label: "Last 3 months" },
  { key: "6", label: "Last 6 months" },
  { key: "12", label: "Last 12 months" },
  { key: "custom", label: "Pick dates" },
];

function AnalyticsPage() {
  const { orgId } = useAuth();
  const [range, setRange] = useState<RangeKey>("6");
  const [custom, setCustom] = useState(lastMonths(6));
  const [branchId, setBranchId] = useState("all");
  const [label, setLabel] = useState("all");
  const options = useAudienceOptions(orgId);

  const { from, to } = range === "custom" ? custom : lastMonths(Number(range));
  const branch = branchId === "all" ? null : branchId;
  const tag = label === "all" ? null : label;

  const a = useQuery({
    queryKey: ["analytics", orgId, from, to, branch, tag],
    enabled: !!orgId && from <= to,
    queryFn: () => fetchAnalytics(from, to, branch, tag),
  });
  const d = a.data;
  const rate = d ? collectionRate(d.collection.expected, d.collection.collected) : null;
  const filtered = !!branch || !!tag;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        subtitle="Trends over time: money in and out, how well dues are collected, and who is owing."
      />

      {/* Filters: one row above everything they affect */}
      <div className="flex flex-wrap items-end gap-3 rounded-3xl border border-border bg-card p-4">
        <div className="w-44">
          <Label className="mb-1.5 block text-xs">Dates</Label>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ranges.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {range === "custom" && (
          <>
            <div>
              <Label htmlFor="a-from" className="mb-1.5 block text-xs">
                From
              </Label>
              <Input
                id="a-from"
                type="date"
                value={custom.from}
                max={custom.to}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="a-to" className="mb-1.5 block text-xs">
                To
              </Label>
              <Input
                id="a-to"
                type="date"
                value={custom.to}
                max={todayIso()}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
              />
            </div>
          </>
        )}
        <div className="w-44">
          <Label className="mb-1.5 block text-xs">Branch</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {(options.data?.branches ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(options.data?.labels.length ?? 0) > 0 && (
          <div className="w-44">
            <Label className="mb-1.5 block text-xs">Label</Label>
            <Select value={label} onValueChange={setLabel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {(options.data?.labels ?? []).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {filtered && (
          <p className="text-xs text-muted-foreground sm:ml-auto sm:max-w-xs">
            Branch and label narrow the member figures. Money in and out is always the whole
            organization.
          </p>
        )}
      </div>

      {a.isLoading || !d ? (
        <div className="grid place-items-center py-20">
          {from > to ? (
            <p className="text-sm text-muted-foreground">The start date is after the end date.</p>
          ) : (
            <Loader2 className="size-6 animate-spin text-primary" />
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Money in" value={naira(d.totals.income)} tone="good" />
            <StatCard label="Money out" value={naira(d.totals.expense)} tone="bad" />
            <StatCard
              label="Dues collected"
              value={rate === null ? "—" : `${rate}%`}
              tone="accent"
              hint={`${naira(d.collection.collected)} of ${naira(d.collection.expected)}`}
            />
            <StatCard
              label="Owed now"
              value={naira(d.owed)}
              tone="bad"
              hint="Including late charges"
            />
            <StatCard
              label="Never paid anything"
              value={`${d.members.never_paid} of ${d.members.active}`}
              hint={`${d.members.joined} joined in these dates`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <MoneyByMonthChart data={d.monthly} />
            <CollectionRateChart data={d.monthly} />
          </div>
          <AgingChart data={d.aging} />

          <div className="grid gap-4 lg:grid-cols-2">
            <SimpleTable
              title="Dues collected, per due"
              headers={["Due", "Due in these dates", "Collected", "Rate"]}
              rows={d.per_due.map((x) => {
                const r = collectionRate(x.expected, x.collected);
                return [x.name, naira(x.expected), naira(x.collected), r === null ? "—" : `${r}%`];
              })}
              empty="No dues fell in these dates."
            />
            <SimpleTable
              title="Owing most"
              headers={["Member", "Owing"]}
              rows={d.top_owing.map((x) => [
                <Link
                  key={x.id}
                  to="/members/$memberId"
                  params={{ memberId: x.id }}
                  className="link"
                >
                  {x.name}
                </Link>,
                naira(x.owing),
              ])}
              empty="Nobody is owing."
            />
            <SimpleTable
              title="Spending by category"
              headers={["What", "Spent"]}
              rows={d.spending.map((x) => [x.label, naira(x.amount)])}
              empty="Nothing spent in these dates."
            />
            <SimpleTable
              title="How money moved"
              headers={["Mode", "In", "Out"]}
              rows={d.channels.map((x) => [
                channelLabel(x.channel),
                naira(x.income),
                naira(x.expense),
              ])}
              empty="Nothing recorded in these dates."
            />
          </div>
        </>
      )}
    </div>
  );
}

function SimpleTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  return (
    <section className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
      <h2 className="px-5 pt-5 font-display text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="mt-3 w-full min-w-[28rem] text-sm">
          <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
            <tr>
              {headers.map((h, i) => (
                <th key={h} className={`px-5 py-2.5 ${i > 0 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={`px-5 py-2.5 ${j > 0 ? "text-right" : ""}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
