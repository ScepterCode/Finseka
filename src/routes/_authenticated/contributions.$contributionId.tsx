import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { initials, naira, shortDate, todayIso } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/page-parts";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/contributions/$contributionId")({
  head: () => ({
    meta: [
      { title: "Contribution tracker — FinSeka" },
      { name: "description", content: "See who paid this contribution and how much is collected." },
      { property: "og:title", content: "Contribution tracker — FinSeka" },
      { property: "og:description", content: "Paid and not paid lists for one contribution." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContributionDetail,
});

type Person = { id: string; name: string; phone: string | null };

function ContributionDetail() {
  const { contributionId } = Route.useParams();
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<Person | null>(null);

  const contribution = useQuery({
    queryKey: ["contribution", contributionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("id, name, reason, amount_per_person, target_amount, due_date, closed")
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
        .select("id, member_id, amount, paid_at, note")
        .eq("contribution_id", contributionId);
      if (error) throw error;
      return data;
    },
  });

  const record = useMutation({
    mutationFn: async (input: { memberId: string; amount: number; date: string; note: string }) => {
      const { error } = await supabase.from("contribution_payments").insert({
        org_id: orgId!,
        contribution_id: contributionId,
        member_id: input.memberId,
        amount: input.amount,
        paid_at: input.date,
        note: input.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setPaying(null);
      queryClient.invalidateQueries({ queryKey: ["contribution-payments"] });
      queryClient.invalidateQueries({ queryKey: ["contributions"] });
      queryClient.invalidateQueries({ queryKey: ["ledger"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = useMutation({
    mutationFn: async (closed: boolean) => {
      const { error } = await supabase
        .from("contributions")
        .update({ closed })
        .eq("id", contributionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contribution", contributionId] });
      queryClient.invalidateQueries({ queryKey: ["contributions"] });
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
  const paidByMember = new Map<string, number>();
  for (const p of payments.data ?? []) {
    paidByMember.set(p.member_id, (paidByMember.get(p.member_id) ?? 0) + Number(p.amount));
  }
  const all = people.data ?? [];
  const expected = Number(c.amount_per_person);
  const paid = all.filter((m) => (paidByMember.get(m.id) ?? 0) >= expected && expected > 0);
  const notPaid = all.filter((m) => !paidByMember.get(m.id));
  const collected = [...paidByMember.values()].reduce((s, v) => s + v, 0);
  const target = Number(c.target_amount ?? 0) || expected * all.length || 0;
  const pct = target > 0 ? Math.min((collected / target) * 100, 100) : 0;
  const overdue = !!c.due_date && !c.closed && new Date(c.due_date) < new Date(todayIso());

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-2">
        <Link to="/contributions">
          <ArrowLeft className="size-4" /> All contributions
        </Link>
      </Button>

      <PageHeader
        title={c.name}
        subtitle={`${c.reason || "No reason added"} · ${naira(expected)} each${
          c.due_date ? ` · due ${shortDate(c.due_date)}` : ""
        }`}
        action={
          isAdmin ? (
            <Button variant="outline" onClick={() => close.mutate(!c.closed)}>
              {c.closed ? "Reopen" : "Close contribution"}
            </Button>
          ) : c.closed ? (
            <Badge variant="secondary">Closed</Badge>
          ) : null
        }
      />

      {overdue && (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-3 text-sm font-medium text-destructive">
          Due date has passed — {notPaid.length} people have not paid yet.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Collected" value={naira(collected)} tone="good" />
        <StatCard label="Target" value={naira(target)} tone="accent" />
        <StatCard
          label="Not paid"
          value={`${notPaid.length} of ${all.length}`}
          tone={overdue ? "bad" : "default"}
        />
      </div>

      <div className="space-y-2 rounded-3xl border border-border bg-card p-6 shadow-soft">
        <Progress value={pct} />
        <p className="text-sm text-muted-foreground">{Math.round(pct)}% of target collected</p>
      </div>

      {all.length === 0 ? (
        <EmptyState title="No members selected" hint="Nobody was picked for this contribution." />
      ) : (
        <Tabs defaultValue="notpaid">
          <TabsList>
            <TabsTrigger value="notpaid">Not paid ({notPaid.length})</TabsTrigger>
            <TabsTrigger value="paid">Paid ({paid.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="notpaid" className="mt-5">
            <PeopleList
              people={notPaid}
              tone={overdue ? "bad" : "muted"}
              note={() => (overdue ? "Overdue" : "Not paid")}
              action={
                isAdmin && !c.closed
                  ? (m) => (
                      <Button size="sm" onClick={() => setPaying(m)}>
                        Mark paid
                      </Button>
                    )
                  : undefined
              }
            />
          </TabsContent>
          <TabsContent value="paid" className="mt-5">
            <PeopleList
              people={paid}
              tone="good"
              note={(m) => naira(paidByMember.get(m.id) ?? 0)}
              action={() => <Check className="size-5 text-success" />}
            />
          </TabsContent>
        </Tabs>
      )}

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
              defaultAmount={Math.max(expected - (paidByMember.get(paying.id) ?? 0), 0)}
              pending={record.isPending}
              onSubmit={(amount, date, note) =>
                record.mutate({ memberId: paying.id, amount, date, note })
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PayForm({
  defaultAmount,
  pending,
  onSubmit,
}: {
  defaultAmount: number;
  pending: boolean;
  onSubmit: (amount: number, date: string, note: string) => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Number(amount || 0), date, note);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="cp-amount">How much did they pay? (₦)</Label>
        <Input
          id="cp-amount"
          required
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
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
    </form>
  );
}

function PeopleList({
  people,
  note,
  action,
  tone,
}: {
  people: Person[];
  note?: ((m: Person) => string) | undefined;
  action?: ((m: Person) => React.ReactNode) | undefined;
  tone: "good" | "bad" | "muted";
}) {
  if (people.length === 0) {
    return <EmptyState title="Nobody here" hint="This list is empty." />;
  }
  const noteClass =
    tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-muted-foreground";

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      {people.map((m) => (
        <li key={m.id} className="flex items-center gap-4 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
            {initials(m.name)}
          </span>
          <span className="min-w-0 flex-1">
            <Link
              to="/members/$memberId"
              params={{ memberId: m.id }}
              className="block truncate font-medium hover:underline"
            >
              {m.name}
            </Link>
            <span className="block truncate text-xs text-muted-foreground">
              {m.phone || "No phone"}
            </span>
          </span>
          {note && (
            <Badge variant="secondary" className={`hidden sm:inline-flex ${noteClass}`}>
              {note(m)}
            </Badge>
          )}
          {action?.(m)}
        </li>
      ))}
    </ul>
  );
}
