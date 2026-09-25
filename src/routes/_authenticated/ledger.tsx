import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { localIso, naira, shortDate, todayIso } from "@/lib/format";
import { fetchLedgerTotals } from "@/lib/totals";
import { methodShort, type PayMethod } from "@/lib/methods";
import { MethodSelect } from "@/components/method-select";
import { EmptyState, PageHeader, StatCard } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/ledger")({
  head: () => ({
    meta: [
      { title: "Ledger — FinSeka" },
      {
        name: "description",
        content: "Money in and money out of your association purse, in cash and in the bank.",
      },
      { property: "og:title", content: "Ledger — FinSeka" },
      { property: "og:description", content: "Money in, money out, cash and bank balance." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LedgerPage,
});

const ranges = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "14", label: "Last 2 weeks", days: 14 },
  { key: "30", label: "This month", days: 30 },
  { key: "90", label: "Last 3 months", days: 90 },
  { key: "365", label: "This year", days: 365 },
  { key: "custom", label: "Pick dates", days: 0 },
] as const;

/** Ledger rows are loaded this many at a time; totals come from the database. */
const PAGE_SIZE = 100;

function daysAgoIso(days: number) {
  const now = new Date();
  return localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

function LedgerPage() {
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<string>("7");
  const [from, setFrom] = useState(daysAgoIso(7));
  const [to, setTo] = useState(todayIso());

  const activeRange = ranges.find((r) => r.key === range) ?? ranges[0];
  const fromDate = range === "custom" ? from : daysAgoIso(activeRange.days);
  const toDate = range === "custom" ? to : todayIso();

  const members = useQuery({
    queryKey: ["members-simple", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const entries = useInfiniteQuery({
    queryKey: ["ledger", orgId, fromDate, toDate],
    enabled: !!orgId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from("ledger_entries")
        .select(
          "id, kind, label, description, amount, entry_date, method, source_table, member_id, members(name)",
        )
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last, pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });

  const allTime = useQuery({
    queryKey: ["ledger-balance", orgId],
    enabled: !!orgId,
    queryFn: () => fetchLedgerTotals(),
  });

  const rangeTotals = useQuery({
    queryKey: ["ledger", orgId, "totals", fromDate, toDate],
    enabled: !!orgId,
    queryFn: () => fetchLedgerTotals(fromDate, toDate),
  });

  const rows = entries.data?.pages.flat() ?? [];
  const rangeIncome = rangeTotals.data?.income ?? 0;
  const rangeExpense = rangeTotals.data?.expense ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ledger"
        subtitle="Everything that entered and left the purse — dues and contributions land here automatically."
        action={
          isAdmin ? (
            <AddEntryDialog
              members={members.data ?? []}
              onDone={() => {
                queryClient.invalidateQueries({ queryKey: ["ledger"] });
                queryClient.invalidateQueries({ queryKey: ["ledger-balance"] });
                queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                queryClient.invalidateQueries({ queryKey: ["reports"] });
              }}
            />
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total purse"
          value={naira(allTime.data?.balance ?? 0)}
          hint="Cash plus bank, all time"
        />
        <StatCard label="Cash at hand" value={naira(allTime.data?.cash ?? 0)} tone="accent" hint="Physical cash" />
        <StatCard label="In the bank" value={naira(allTime.data?.bank ?? 0)} tone="accent" hint="Bank transfers" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Money in" value={naira(rangeIncome)} tone="good" hint={activeRange.label} />
        <StatCard label="Money out" value={naira(rangeExpense)} tone="bad" hint={activeRange.label} />
      </div>

      <div className="space-y-4">
        <Tabs value={range} onValueChange={setRange}>
          <TabsList className="flex-wrap">
            {ranges.map((r) => (
              <TabsTrigger key={r.key} value={r.key}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {range === "custom" && (
          <div className="flex flex-wrap gap-4 rounded-3xl border border-border bg-card p-5">
            <div className="space-y-1.5">
              <Label htmlFor="l-from">From</Label>
              <Input
                id="l-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="l-to">To</Label>
              <Input id="l-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {entries.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing in this period"
          hint="Record an expense, or pick a wider date range."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {rows.map((e) => {
            const income = e.kind === "income";
            return (
              <li key={e.id} className="flex items-center gap-4 px-5 py-4">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full ${
                    income ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive"
                  }`}
                >
                  {income ? (
                    <ArrowDownLeft className="size-4" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {e.description || e.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {shortDate(e.entry_date)} · {methodShort(e.method)}
                    {(e.members as { name: string } | null)?.name
                      ? ` · ${(e.members as { name: string }).name}`
                      : ""}
                  </span>
                </span>
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  {e.label}
                </Badge>
                <span className={`font-semibold ${income ? "text-success" : "text-destructive"}`}>
                  {income ? "+" : "−"}
                  {naira(e.amount)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {entries.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void entries.fetchNextPage()}
            disabled={entries.isFetchingNextPage}
          >
            {entries.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />} Show more
          </Button>
        </div>
      )}
    </div>
  );
}

function AddEntryDialog({
  members,
  onDone,
}: {
  members: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { orgId } = useAuth();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState<string>("none");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [label, setLabel] = useState("Expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [date, setDate] = useState(todayIso());

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("ledger_entries").insert({
        org_id: orgId!,
        kind,
        label: label || (kind === "income" ? "Donation" : "Expense"),
        description: description || null,
        amount: Number(amount || 0),
        entry_date: date,
        method,
        member_id: memberId === "none" ? null : memberId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved to ledger");
      setDescription("");
      setAmount("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="gap-2">
          <Plus className="size-4" /> Add entry
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add to ledger</DialogTitle>
          <DialogDescription>Money that entered or left the purse.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as "income" | "expense");
                setLabel(v === "income" ? "Donation" : "Expense");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Money out (expense)</SelectItem>
                <SelectItem value="income">Money in (donation, other)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-label">Short label</Label>
            <Input
              id="e-label"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Expense"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-desc">What was it for?</Label>
            <Input
              id="e-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Bought chairs for the hall"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-amount">Amount (₦)</Label>
            <Input
              id="e-amount"
              required
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <MethodSelect value={method} onChange={setMethod} />
          <div className="space-y-2">
            <Label>Which member is this about? (optional)</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger>
                <SelectValue placeholder="Nobody in particular" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nobody in particular</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-date">Date</Label>
            <Input id="e-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save entry
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
