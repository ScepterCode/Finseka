import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { initials, naira, todayIso } from "@/lib/format";
import {
  currentPeriod,
  frequencyLabels,
  isPastPeriod,
  periodOptions,
  type Frequency,
} from "@/lib/periods";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/dues/$dueId")({
  head: () => ({
    meta: [
      { title: "Due tracker — FinSeka" },
      { name: "description", content: "See who has paid this due and who has not." },
      { property: "og:title", content: "Due tracker — FinSeka" },
      { property: "og:description", content: "Paid and not paid lists for one due." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DueDetail,
});

type Member = { id: string; name: string; phone: string | null };

function DueDetail() {
  const { dueId } = Route.useParams();
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<string | null>(null);
  const [paying, setPaying] = useState<Member | null>(null);

  const due = useQuery({
    queryKey: ["due", dueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dues")
        .select("id, name, amount, frequency, notes, active")
        .eq("id", dueId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const members = useQuery({
    queryKey: ["members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name, phone")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as Member[];
    },
  });

  const frequency = (due.data?.frequency ?? "monthly") as Frequency;
  const activePeriod = period ?? currentPeriod(frequency);

  const payments = useQuery({
    queryKey: ["due-payments", dueId, activePeriod],
    enabled: !!due.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("due_payments")
        .select("id, member_id, amount, paid_at, note")
        .eq("due_id", dueId)
        .eq("period_label", activePeriod);
      if (error) throw error;
      return data;
    },
  });

  const record = useMutation({
    mutationFn: async (input: { memberId: string; amount: number; date: string; note: string }) => {
      const { error } = await supabase.from("due_payments").insert({
        org_id: orgId!,
        due_id: dueId,
        member_id: input.memberId,
        period_label: activePeriod,
        amount: input.amount,
        paid_at: input.date,
        note: input.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setPaying(null);
      queryClient.invalidateQueries({ queryKey: ["due-payments"] });
      queryClient.invalidateQueries({ queryKey: ["ledger"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (due.isLoading || members.isLoading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!due.data) {
    return (
      <EmptyState
        title="Due not found"
        hint="It may have been deleted."
        action={
          <Button asChild variant="outline">
            <Link to="/dues">Back to dues</Link>
          </Button>
        }
      />
    );
  }

  const paidByMember = new Map<string, number>();
  for (const p of payments.data ?? []) {
    paidByMember.set(p.member_id, (paidByMember.get(p.member_id) ?? 0) + Number(p.amount));
  }

  const expected = Number(due.data.amount);
  const all = members.data ?? [];
  const paid = all.filter((m) => (paidByMember.get(m.id) ?? 0) >= expected && expected > 0);
  const partial = all.filter(
    (m) => (paidByMember.get(m.id) ?? 0) > 0 && (paidByMember.get(m.id) ?? 0) < expected,
  );
  const notPaid = all.filter((m) => !paidByMember.get(m.id));
  const collected = [...paidByMember.values()].reduce((s, v) => s + v, 0);
  const overdue = isPastPeriod(frequency, activePeriod);

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-2">
        <Link to="/dues">
          <ArrowLeft className="size-4" /> All dues
        </Link>
      </Button>

      <PageHeader
        title={due.data.name}
        subtitle={`${naira(due.data.amount)} · ${frequencyLabels[frequency]}${
          due.data.notes ? ` · ${due.data.notes}` : ""
        }`}
        action={
          <div className="w-full sm:w-56">
            <Label className="mb-1.5 block text-xs">Period</Label>
            <Select value={activePeriod} onValueChange={setPeriod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periodOptions(frequency).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Collected" value={naira(collected)} tone="good" hint={activePeriod} />
        <StatCard
          label="Still owing"
          value={naira(Math.max(expected * all.length - collected, 0))}
          tone={overdue ? "bad" : "default"}
          hint={overdue ? "This period has passed — overdue" : "For this period"}
        />
        <StatCard label="People paid" value={`${paid.length} of ${all.length}`} tone="accent" />
      </div>

      {all.length === 0 ? (
        <EmptyState title="No members yet" hint="Add members first, then come back to tick payments." />
      ) : (
        <Tabs defaultValue="notpaid">
          <TabsList>
            <TabsTrigger value="notpaid">
              {overdue ? "Overdue" : "Not paid"} ({notPaid.length})
            </TabsTrigger>
            <TabsTrigger value="paid">Paid ({paid.length})</TabsTrigger>
            <TabsTrigger value="partial">Part payment ({partial.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="notpaid" className="mt-5">
            <MemberList
              members={notPaid}
              tone={overdue ? "bad" : "muted"}
              action={
                isAdmin
                  ? (m) => (
                      <Button size="sm" onClick={() => setPaying(m)}>
                        Mark paid
                      </Button>
                    )
                  : undefined
              }
              note={() => (overdue ? "Overdue" : "Not paid")}
            />
          </TabsContent>

          <TabsContent value="paid" className="mt-5">
            <MemberList
              members={paid}
              tone="good"
              note={(m) => naira(paidByMember.get(m.id) ?? 0)}
              action={() => <Check className="size-5 text-success" />}
            />
          </TabsContent>

          <TabsContent value="partial" className="mt-5">
            <MemberList
              members={partial}
              tone="muted"
              note={(m) => `${naira(paidByMember.get(m.id) ?? 0)} of ${naira(expected)}`}
              action={
                isAdmin
                  ? (m) => (
                      <Button size="sm" variant="outline" onClick={() => setPaying(m)}>
                        Add payment
                      </Button>
                    )
                  : undefined
              }
            />
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {paying?.name} · {due.data.name} · {activePeriod}
            </DialogDescription>
          </DialogHeader>
          {paying && (
            <PaymentForm
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

function PaymentForm({
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
        <Label htmlFor="p-amount">How much did they pay? (₦)</Label>
        <Input
          id="p-amount"
          required
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-date">Date paid</Label>
        <Input id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-note">Note (optional)</Label>
        <Input
          id="p-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Paid cash at meeting"
        />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Save payment
      </Button>
    </form>
  );
}

function MemberList({
  members,
  note,
  action,
  tone,
}: {
  members: Member[];
  note?: (m: Member) => string;
  action?: (m: Member) => React.ReactNode;
  tone: "good" | "bad" | "muted";
}) {
  if (members.length === 0) {
    return <EmptyState title="Nobody here" hint="This list is empty for the chosen period." />;
  }
  const noteClass =
    tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-muted-foreground";

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      {members.map((m) => (
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
