import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { naira } from "@/lib/format";
import { collectionRate, monthTick, nairaShort, type AnalyticsSummary } from "@/lib/analytics";

// Charts for the analytics page. Colors come from the --viz-* tokens in styles.css
// (validated for colour-blind separation). Text stays in the app's text colors.

const axis = { stroke: "var(--viz-grid)", tick: { fill: "var(--viz-axis)", fontSize: 12 } };

function ChartCard({
  title,
  hint,
  children,
  table,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  table: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-soft">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4 h-64">{children}</div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </section>
  );
}

function Tip({
  active,
  label,
  rows,
}: {
  active?: boolean | undefined;
  label?: string;
  rows: { name: string; value: string; color?: string }[];
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lift">
      {label && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2 text-muted-foreground">
          {r.color && <span className="size-2.5 rounded-sm" style={{ background: r.color }} />}
          {r.name}: <span className="font-medium text-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.name} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} /> {i.name}
        </span>
      ))}
    </div>
  );
}

const cell = "px-3 py-1.5";

/** Money in and money out each month: two series side by side on one axis. */
export function MoneyByMonthChart({ data }: { data: AnalyticsSummary["monthly"] }) {
  const rows = data.map((d) => ({
    month: monthTick(d.month),
    income: Number(d.income),
    expense: Number(d.expense),
  }));
  return (
    <ChartCard
      title="Money in and out, by month"
      table={
        <table className="w-full">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className={cell}>Month</th>
              <th className={`${cell} text-right`}>In</th>
              <th className={`${cell} text-right`}>Out</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.month} className="border-t border-border">
                <td className={cell}>{r.month}</td>
                <td className={`${cell} text-right`}>{naira(r.income)}</td>
                <td className={`${cell} text-right`}>{naira(r.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Legend
        items={[
          { name: "Money in", color: "var(--viz-1)" },
          { name: "Money out", color: "var(--viz-2)" },
        ]}
      />
      <ResponsiveContainer width="100%" height="88%">
        <BarChart data={rows} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="month" {...axis} tickLine={false} />
          <YAxis
            {...axis}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={nairaShort}
          />
          <Tooltip
            cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }}
            content={({ active, label, payload }) => (
              <Tip
                active={active}
                label={String(label ?? "")}
                rows={(payload ?? []).map((p) => ({
                  name: p.dataKey === "income" ? "Money in" : "Money out",
                  value: naira(Number(p.value)),
                  color: String(p.color),
                }))}
              />
            )}
          />
          <Bar dataKey="income" fill="var(--viz-1)" maxBarSize={24} radius={[4, 4, 0, 0]} />
          <Bar dataKey="expense" fill="var(--viz-2)" maxBarSize={24} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Share of dues collected for each month's periods: one trend line. */
export function CollectionRateChart({ data }: { data: AnalyticsSummary["monthly"] }) {
  const rows = data.map((d) => ({
    month: monthTick(d.month),
    rate: collectionRate(d.expected, d.collected),
    expected: Number(d.expected),
    collected: Number(d.collected),
  }));
  return (
    <ChartCard
      title="Dues collected, by month"
      hint="Of what members owed for each month's dues, how much was paid"
      table={
        <table className="w-full">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className={cell}>Month</th>
              <th className={`${cell} text-right`}>Due</th>
              <th className={`${cell} text-right`}>Collected</th>
              <th className={`${cell} text-right`}>Rate</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.month} className="border-t border-border">
                <td className={cell}>{r.month}</td>
                <td className={`${cell} text-right`}>{naira(r.expected)}</td>
                <td className={`${cell} text-right`}>{naira(r.collected)}</td>
                <td className={`${cell} text-right`}>{r.rate === null ? "—" : `${r.rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="month" {...axis} tickLine={false} padding={{ left: 16, right: 16 }} />
          <YAxis
            {...axis}
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
            content={({ active, label, payload }) => {
              const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              return (
                <Tip
                  active={active}
                  label={String(label ?? "")}
                  rows={
                    r
                      ? [
                          {
                            name: "Collected",
                            value: r.rate === null ? "nothing due" : `${r.rate}%`,
                          },
                          { name: "Paid", value: `${naira(r.collected)} of ${naira(r.expected)}` },
                        ]
                      : []
                  }
                />
              );
            }}
          />
          <Line
            dataKey="rate"
            stroke="var(--viz-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls={false}
            dot={false}
            activeDot={{ r: 5, fill: "var(--viz-1)", stroke: "var(--viz-surface)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** What members owe, grouped by how late it is: one series, labelled directly. */
export function AgingChart({ data }: { data: AnalyticsSummary["aging"] }) {
  // Short names on the axis so four labels fit on a phone; the full wording is in the
  // tooltip and the table.
  const short: Record<string, string> = {
    "Not yet late": "Not late",
    "Up to 1 month late": "Up to 1 month",
    "1–3 months late": "1–3 months",
    "Over 3 months late": "3+ months",
  };
  const rows = data.map((d) => ({
    ...d,
    tick: short[d.bucket] ?? d.bucket,
    amount: Number(d.amount),
    people: Number(d.people),
  }));
  return (
    <ChartCard
      title="What members owe, by how late it is"
      hint="Late means the period or the contribution's due date has passed"
      table={
        <table className="w-full">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className={cell}>How late</th>
              <th className={`${cell} text-right`}>Owed</th>
              <th className={`${cell} text-right`}>People</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.bucket} className="border-t border-border">
                <td className={cell}>{r.bucket}</td>
                <td className={`${cell} text-right`}>{naira(r.amount)}</td>
                <td className={`${cell} text-right`}>{r.people}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {/* Horizontal bars: the labels sit to the left, so they fit even on a phone. */}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ right: 48 }}>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
          <XAxis type="number" {...axis} tickLine={false} tickFormatter={nairaShort} />
          <YAxis
            type="category"
            dataKey="tick"
            {...axis}
            tickLine={false}
            axisLine={false}
            width={96}
          />
          <Tooltip
            cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }}
            content={({ active, label, payload }) => {
              const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
              return (
                <Tip
                  active={active}
                  label={r?.bucket ?? String(label ?? "")}
                  rows={
                    r
                      ? [
                          { name: "Owed", value: naira(r.amount) },
                          { name: "People", value: String(r.people) },
                        ]
                      : []
                  }
                />
              );
            }}
          />
          <Bar dataKey="amount" fill="var(--viz-1)" maxBarSize={24} radius={[0, 4, 4, 0]}>
            <LabelList
              dataKey="amount"
              position="right"
              formatter={(v: number) => (v > 0 ? nairaShort(v) : "")}
              style={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
