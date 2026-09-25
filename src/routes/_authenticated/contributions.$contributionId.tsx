import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { naira, shortDate, todayIso } from "@/lib/format";
import { methodShort, type PayMethod } from "@/lib/methods";
import { EmptyState, PageHeader, StatCard } from "@/components/page-parts";
import { MethodSelect } from "@/components/method-select";
import { ConfirmButton, ConfirmDialog } from "@/components/confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/contributions/$contributionId")({
  head: () => ({
    meta: [
      { title: "Contribution tracker — FinSeka" },
      { name: "description", content: "See who paid this contribution, event budget and spending." },
      { property: "og:title", content: "Contribution tracker — FinSeka" },
      { property: "og:description", content: "Paid and not paid register for one contribution." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContributionDetail,
});

type Person = { id: string; name: string; phone: string | null };
type Status = "paid" | "part" | "unpaid" | "gave";
type Filter = "all" | "paid" | "part" | "unpaid";

function ContributionDetail() {
  const { contributionId } = Route.useParams();
  const { orgId, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [paying, setPaying] = useState<Person | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [addingExpense, setAddingExpense] = useState(false);

  const contribution = useQuery({
    queryKey: ["contribution", contributionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("*")
        .eq("id", contributionId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const people = useQuery({
    queryKey: ["contribution-members", contributionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contribution_members")
        .select("member_id, members(id, name, phone)")
        .eq("contribution_id", contributionId);
      if (error) throw error;
      return (data ?? [])
        .map((r) => r.members as Person | null)
        .filter((m): m is Person => !!m)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const payments = useQuery({
    queryKey: ["contribution-payments", contributionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contribution_payments")
        .select("id, member_id, amount, paid_at, note, method")
        .eq("contribution_id", contributionId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const expenses = useQuery({
    queryKey: ["contribution-expenses", contributionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contribution_expenses")
        .select("id, description, amount, method, spent_at")
        .eq("contribution_id", contributionId)
        .order("spent_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contribution", contributionId] });
    qc.invalidateQueries({ queryKey: ["contribution-payments"] });
    qc.invalidateQueries({ queryKey: ["contribution-expenses", contributionId] });
    qc.invalidateQueries({ queryKey: ["contributions"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const record = useMutation({
    mutationFn: async (i: {
      memberId: string;
      amount: number;
      date: string;
      note: string;
      method: PayMethod;
      clientRef: string;
    }) => {
      // client_ref makes a retried save a no-op instead of a second payment.
      const { error } = await supabase.from("contribution_payments").upsert(
        {
          org_id: orgId!,
          contribution_id: contributionId,
          member_id: i.memberId,
          amount: i.amount,
          paid_at: i.date,
          note: i.note || null,
          method: i.method,
          client_ref: i.clientRef,
        },
        { onConflict: "client_ref", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setPaying(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = useMutation({
    mutationFn: async (closed: boolean) => {
      const { error } = await supabase.from("contributions").update({ closed }).eq("id", contributionId);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const addExpense = useMutation({
    mutationFn: async (i: { description: string; amount: number; date: string; method: PayMethod }) => {
      const { error } = await supabase.from("contribution_expenses").insert({
        org_id: orgId!,
        contribution_id: contributionId,
        description: i.description,
        amount: i.amount,
        spent_at: i.date,
        method: i.method,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Spending added");
      setAddingExpense(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeExpense = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contribution_expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const postExpenses = useMutation({
    mutationFn: async () => {
      // Posted in one database transaction so it can only happen once per event.
      const { error } = await supabase.rpc("post_contribution_expenses", {
        _contribution_id: contributionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event closed and spending posted to the ledger");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (contribution.isLoading || people.isLoading || payments.isLoading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!contribution.data) {
    return (
      <EmptyState
        title="Contribution not found"
        hint="It may have been deleted."
        action={
          <Button asChild variant="outline">
            <Link to="/contributions">Back to contributions</Link>
          </Button>
        }
      />
    );
  }

  const c = contribution.data;
  const expected = Number(c.amount_per_person);
  const all = people.data ?? [];
  const pays = payments.data ?? [];

  const rows = all.map((m) => {
    const mine = pays.filter((p) => p.member_id === m.id);
    const paid = mine.reduce((s, p) => s + Number(p.amount), 0);
    const last = mine[0];
    let status: Status;
    if (!c.mandatory) status = paid > 0 ? "gave" : "unpaid";
    else if (expected > 0 && paid >= expected) status = "paid";
    else if (paid > 0) status = "part";
    else status = "unpaid";
    return {
      person: m,
      paid,
      balance: c.mandatory ? Math.max(expected - paid, 0) : 0,
      date: last?.paid_at ?? null,
      method: last?.method ?? null,
      status,
    };
  });

  const paidCount = rows.filter((r) => r.status === "paid" || r.status === "gave").length;
  const partCount = rows.filter((r) => r.status === "part").length;
  const unpaidCount = rows.filter((r) => r.status === "unpaid").length;
  const collected = pays.reduce((s, p) => s + Number(p.amount), 0);
  const target = Number(c.target_amount ?? 0) || expected * all.length || 0;
  const pct = target > 0 ? Math.min((collected / target) * 100, 100) : 0;
  const overdue = !!c.due_date && !c.closed && new Date(c.due_date) < new Date(todayIso());

  const spent = (expenses.data ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const budget = Number(c.budget_amount ?? 0);
  const committee = (c.committee ?? []) as string[];

  const shown = rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "paid"
        ? r.status === "paid" || r.status === "gave"
        : r.status === filter,
  );

  const total = Math.max(all.length, 1);

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-2">
        <Link to="/contributions">
          <ArrowLeft className="size-4" /> All contributions
        </Link>
      </Button>

      <PageHeader
        title={c.name}
        subtitle={`${c.reason || "No reason added"} · ${c.mandatory ? `${naira(expected)} each` : "Freewill"}${
          c.due_date ? ` · due ${shortDate(c.due_date)}` : ""
        }`}
        action={
          isAdmin && !c.expenses_posted ? (
            <Button variant="outline" onClick={() => close.mutate(!c.closed)}>
              {c.closed ? "Reopen" : "Close contribution"}
            </Button>
          ) : c.closed ? (
            <Badge variant="secondary">Closed</Badge>
          ) : null
        }
      />

      {overdue && unpaidCount > 0 && (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-3 text-sm font-medium text-destructive">
          Due date has passed — {unpaidCount} people have not paid yet.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Collected" value={naira(collected)} tone="good" />
        <StatCard label="Target" value={naira(target)} tone="accent" />
        <StatCard label="Not paid" value={`${unpaidCount} of ${all.length}`} tone={overdue ? "bad" : "default"} />
      </div>

      <div className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-soft">
        <div>
          <Progress value={pct} />
          <p className="mt-2 text-sm text-muted-foreground">{Math.round(pct)}% of target collected</p>
        </div>
        <div>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-success" style={{ width: `${(paidCount / total) * 100}%` }} />
            <div className="bg-accent" style={{ width: `${(partCount / total) * 100}%` }} />
            <div className="bg-destructive/70" style={{ width: `${(unpaidCount / total) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <Legend className="bg-success" label={`Paid ${paidCount}`} />
            {c.mandatory && <Legend className="bg-accent" label={`Part paid ${partCount}`} />}
            <Legend className="bg-destructive/70" label={`Not paid ${unpaidCount}`} />
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Payment register</h2>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="paid">Paid</TabsTrigger>
              {c.mandatory && <TabsTrigger value="part">Part</TabsTrigger>}
              <TabsTrigger value="unpaid">Not paid</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {all.length === 0 ? (
          <EmptyState title="No members selected" hint="Nobody was picked for this contribution." />
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  {c.mandatory && <th className="px-4 py-3 text-right">Owing</th>}
                  <th className="px-4 py-3">Date paid</th>
                  <th className="px-4 py-3">How</th>
                  {isAdmin && !c.closed && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => (
                  <tr key={r.person.id}>
                    <td className="px-4 py-3">
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: r.person.id }}
                        className="font-medium hover:underline"
                      >
                        {r.person.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} overdue={overdue} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{naira(r.paid)}</td>
                    {c.mandatory && (
                      <td className={`px-4 py-3 text-right ${r.balance > 0 ? "text-destructive" : ""}`}>
                        {naira(r.balance)}
                      </td>
                    )}
                    <td className="px-4 py-3 text-muted-foreground">{r.date ? shortDate(r.date) : "—"}</td>
                    <td className="px-4 py-3">
                      {r.method ? <Badge variant="outline">{methodShort(r.method)}</Badge> : "—"}
                    </td>
                    {isAdmin && !c.closed && (
                      <td className="px-4 py-3 text-right">
                        {r.status !== "paid" && (
                          <Button size="sm" onClick={() => setPaying(r.person)}>
                            {r.paid > 0 ? "Add payment" : "Mark paid"}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Nobody here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Event budget & spending</h2>
          {isAdmin && !c.expenses_posted && (
            <Button variant="outline" className="gap-2" onClick={() => setAddingExpense(true)}>
              <Plus className="size-4" /> Add spending
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Budget" value={budget ? naira(budget) : "Not set"} tone="accent" />
          <StatCard label="Spent so far" value={naira(spent)} tone="default" />
          <StatCard
            label={budget && spent > budget ? "Over budget" : "Left in budget"}
            value={budget ? naira(Math.abs(budget - spent)) : "—"}
            tone={budget && spent > budget ? "bad" : "good"}
          />
        </div>
        <div className="rounded-3xl border border-border bg-card p-5 shadow-soft">
          <p className="text-sm font-medium">Committee</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {committee.length === 0 ? (
              <span className="text-sm text-muted-foreground">No committee picked.</span>
            ) : (
              committee.map((n) => (
                <Badge key={n} variant="secondary">
                  {n}
                </Badge>
              ))
            )}
          </div>
        </div>
        {(expenses.data ?? []).length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            {(expenses.data ?? []).map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.description}</span>
                  <span className="text-xs text-muted-foreground">
                    {shortDate(e.spent_at)} · {methodShort(e.method)}
                  </span>
                </span>
                <span className="font-semibold text-destructive">{naira(Number(e.amount))}</span>
                {isAdmin && !c.expenses_posted && (
                  <ConfirmButton
                    size="icon"
                    variant="ghost"
                    title="Remove this spending?"
                    description={`${e.description} — ${naira(Number(e.amount))}`}
                    confirmLabel="Yes, remove"
                    destructive
                    onConfirm={() => removeExpense.mutate(e.id)}
                  >
                    <Trash2 className="size-4" />
                  </ConfirmButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {c.expenses_posted ? (
          <p className="rounded-2xl bg-success/10 px-5 py-3 text-sm font-medium text-success">
            Event closed — {naira(spent)} spending was posted to the ledger.
          </p>
        ) : (
          isAdmin && (
            <ConfirmButton
              size="lg"
              className="w-full sm:w-auto"
              disabled={postExpenses.isPending}
              title="Close event and post spending?"
              description={`This will close "${c.name}" and add ${naira(spent)} to the ledger as "Expenses from ${c.name}". You can't undo this.`}
              confirmLabel="Yes, close and post"
              onConfirm={() => postExpenses.mutate()}
            >
              {postExpenses.isPending && <Loader2 className="size-4 animate-spin" />} Close event & post to ledger
            </ConfirmButton>
          )
        )}
      </section>

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {paying?.name} · {c.name}
            </DialogDescription>
          </DialogHeader>
          {paying && (
            <PayForm
              name={paying.name}
              defaultAmount={
                c.mandatory
                  ? Math.max(expected - (rows.find((r) => r.person.id === paying.id)?.paid ?? 0), 0)
                  : 0
              }
              pending={record.isPending}
              onSubmit={(amount, date, note, method, clientRef) =>
                record.mutate({ memberId: paying.id, amount, date, note, method, clientRef })
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addingExpense} onOpenChange={setAddingExpense}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add spending</DialogTitle>
            <DialogDescription>Stays on this event until you post it to the ledger.</DialogDescription>
          </DialogHeader>
          <ExpenseForm pending={addExpense.isPending} onSubmit={(v) => addExpense.mutate(v)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`size-3 rounded-full ${className}`} /> {label}
    </span>
  );
}

function StatusBadge({ status, overdue }: { status: Status; overdue: boolean }) {
  if (status === "paid" || status === "gave")
    return <Badge className="bg-success/15 text-success hover:bg-success/15">{status === "gave" ? "Gave" : "Paid"}</Badge>;
  if (status === "part") return <Badge className="bg-accent/15 text-accent hover:bg-accent/15">Part paid</Badge>;
  return (
    <Badge variant="secondary" className={overdue ? "text-destructive" : "text-muted-foreground"}>
      {overdue ? "Overdue" : "Not paid"}
    </Badge>
  );
}

function PayForm({
  name,
  defaultAmount,
  pending,
  onSubmit,
}: {
  name: string;
  defaultAmount: number;
  pending: boolean;
  onSubmit: (amount: number, date: string, note: string, method: PayMethod, clientRef: string) => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [confirm, setConfirm] = useState(false);
  const [clientRef] = useState(() => crypto.randomUUID());

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirm(true);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="cp-amount">How much did they pay? (₦)</Label>
        <Input id="cp-amount" required type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <MethodSelect value={method} onChange={setMethod} />
      <div className="space-y-2">
        <Label htmlFor="cp-date">Date paid</Label>
        <Input id="cp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp-note">Note (optional)</Label>
        <Input id="cp-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Save payment
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Confirm payment?"
        description={`${name} paid ${naira(Number(amount || 0))} by ${method === "cash" ? "cash" : "bank transfer"}.`}
        confirmLabel="Yes, record it"
        onConfirm={() => onSubmit(Number(amount || 0), date, note, method, clientRef)}
      />
    </form>
  );
}

function ExpenseForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: { description: string; amount: number; date: string; method: PayMethod }) => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState<PayMethod>("cash");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ description, amount: Number(amount || 0), date, method });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="ce-desc">What was it for?</Label>
        <Input id="ce-desc" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Canopy hire" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ce-amount">Amount (₦)</Label>
        <Input id="ce-amount" required type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <MethodSelect value={method} onChange={setMethod} label="Paid by cash or transfer?" />
      <div className="space-y-2">
        <Label htmlFor="ce-date">Date</Label>
        <Input id="ce-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Save spending
      </Button>
    </form>
  );
}
