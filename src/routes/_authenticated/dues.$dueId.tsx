import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { initials, naira, shortDate, todayIso } from "@/lib/format";
import { DueAudienceFields } from "@/components/due-audience-fields";
import { PaymentModeFields } from "@/components/method-select";
import { defaultPaymentMode, type PaymentMode } from "@/lib/methods";
import { RemindButton } from "@/components/remind-button";
import {
  audienceIsValid,
  describeAudience,
  saveDueMembers,
  type Audience,
  type AudienceValue,
} from "@/lib/audience";
import { SearchBox } from "@/components/search-box";
import { matchesPerson } from "@/lib/search";
import { frequencyLabels, type Frequency } from "@/lib/periods";
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

type Member = { id: string; name: string; phone: string | null; joined_on: string };

/** How many periods the period picker lists (a daily due can have hundreds). */
const PERIOD_PICKER_LIMIT = 60;

function DueDetail() {
  const { dueId } = Route.useParams();
  const { orgId, isAdmin, org } = useAuth();
  const queryClient = useQueryClient();
  const [periodStart, setPeriodStart] = useState<string | null>(null);
  const [paying, setPaying] = useState<Member | null>(null);
  const [search, setSearch] = useState("");

  const due = useQuery({
    queryKey: ["due", dueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dues")
        .select(
          "id, name, amount, frequency, notes, active, penalty_amount, penalty_grace_days, starts_on, audience, audience_labels, audience_branch_ids",
        )
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
      const data = await fetchAll((from, to) =>
        supabase
          .from("members")
          .select("id, name, phone, joined_on")
          .eq("active", true)
          .order("name")
          .order("id")
          .range(from, to),
      );
      return data as Member[];
    },
  });

  const frequency = (due.data?.frequency ?? "monthly") as Frequency;

  const branchNames = useQuery({
    queryKey: ["branches", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
    select: (rows) => new Map(rows.map((b) => [b.id, b.name])),
  });

  // The active members this due applies to (everyone, a label, a branch or picked people).
  const appliesTo = useQuery({
    queryKey: ["due-applies-to", dueId],
    queryFn: async () => {
      const [ids, picked] = await Promise.all([
        supabase.rpc("due_member_ids", { _due_id: dueId }),
        fetchAll((from, to) =>
          supabase
            .from("due_members")
            .select("member_id")
            .eq("due_id", dueId)
            .order("id")
            .range(from, to),
        ),
      ]);
      if (ids.error) throw ids.error;
      return { ids: new Set(ids.data ?? []), picked: picked.map((p) => p.member_id) };
    },
  });

  // Every period of this due since it started, newest first, with the amount for each.
  const periods = useQuery({
    queryKey: ["due-periods", dueId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("due_period_list", { _due_id: dueId });
      if (error) throw error;
      return data ?? [];
    },
  });
  const periodList = periods.data ?? [];
  const selected =
    periodList.find((p) => p.period_start === periodStart) ??
    periodList.find((p) => p.is_current) ??
    periodList[0];

  const payments = useQuery({
    queryKey: ["due-payments", dueId, selected?.period_start],
    enabled: !!selected,
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase
          .from("due_payments")
          .select("id, member_id, amount, paid_at, note")
          .eq("due_id", dueId)
          .eq("period_start", selected!.period_start)
          .is("voided_at", null)
          .order("id")
          .range(from, to),
      );
      return data;
    },
  });

  const record = useMutation({
    mutationFn: async (input: {
      memberId: string;
      amount: number;
      date: string;
      note: string;
      method: PaymentMode;
      clientRef: string;
    }) => {
      // client_ref makes a retried save a no-op instead of a second payment.
      const { error } = await supabase.from("due_payments").upsert(
        {
          org_id: orgId!,
          due_id: dueId,
          member_id: input.memberId,
          period_start: selected!.period_start,
          period_label: selected!.label,
          amount: input.amount,
          paid_at: input.date,
          note: input.note || null,
          channel: input.method.channel,
          reference: input.method.reference || null,
          client_ref: input.clientRef,
        },
        { onConflict: "client_ref", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setPaying(null);
      queryClient.invalidateQueries({ queryKey: ["due-payments"] });
      queryClient.invalidateQueries({ queryKey: ["ledger"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const [editing, setEditing] = useState(false);
  const saveDue = useMutation({
    mutationFn: async ({ audience, ...patch }: DuePatch & { audience: AudienceValue }) => {
      if (!audienceIsValid(audience)) throw new Error("Pick who should pay this due.");
      const { error } = await supabase
        .from("dues")
        .update({
          ...patch,
          audience: audience.audience,
          audience_labels: audience.audience === "labels" ? audience.labels : [],
          audience_branch_ids: audience.audience === "branches" ? audience.branchIds : [],
        })
        .eq("id", dueId);
      if (error) throw error;
      await saveDueMembers(
        orgId!,
        dueId,
        appliesTo.data?.picked ?? [],
        audience.audience === "people" ? audience.memberIds : [],
      );
    },
    onSuccess: () => {
      toast.success("Due updated");
      setEditing(false);
      for (const key of [
        "due",
        "dues",
        "dashboard",
        "reports",
        "due-applies-to",
        "member-standing",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  // A new amount applies from the chosen period onward; earlier periods keep their price.
  const changeAmount = useMutation({
    mutationFn: async (v: { amount: number; from: string }) => {
      const { error } = await supabase.rpc("change_due_amount", {
        _due_id: dueId,
        _amount: v.amount,
        _from: v.from,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("New amount saved");
      setEditing(false);
      for (const key of ["due", "due-periods", "dues", "dashboard", "reports", "member-standing"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (due.isLoading || members.isLoading || periods.isLoading || appliesTo.isLoading) {
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

  const expected = Number(selected?.expected ?? due.data.amount);
  // Only people who had joined by the end of this period are expected to pay for it.
  const all = (members.data ?? []).filter(
    (m) =>
      appliesTo.data?.ids.has(m.id) &&
      (!selected?.period_end || m.joined_on <= selected.period_end),
  );
  const paid = all.filter((m) => (paidByMember.get(m.id) ?? 0) >= expected && expected > 0);
  const partial = all.filter(
    (m) => (paidByMember.get(m.id) ?? 0) > 0 && (paidByMember.get(m.id) ?? 0) < expected,
  );
  const notPaid = all.filter((m) => !paidByMember.get(m.id));
  // The totals above always cover everyone; the search only narrows the lists below.
  const find = (list: Member[]) => list.filter((m) => matchesPerson(search, m.name, m.phone));
  const collected = [...paidByMember.values()].reduce((s, v) => s + v, 0);
  const overdue = selected?.is_past ?? false;
  const periodLabel = selected?.label ?? "";

  return (
    <div className="space-y-8">
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link to="/dues">
          <ArrowLeft className="size-4" /> All dues
        </Link>
      </Button>

      <PageHeader
        title={due.data.name}
        subtitle={`${naira(due.data.amount)} · ${frequencyLabels[frequency]} · ${describeAudience(due.data, branchNames.data)}${
          due.data.notes ? ` · ${due.data.notes}` : ""
        }`}
        action={
          <div className="flex w-full items-end gap-2 sm:w-auto">
            <div className="w-full sm:w-56">
              <Label className="mb-1.5 block text-xs">Period</Label>
              <Select value={selected?.period_start ?? ""} onValueChange={setPeriodStart}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periodList.slice(0, PERIOD_PICKER_LIMIT).map((p) => (
                    <SelectItem key={p.period_start} value={p.period_start}>
                      {p.label}
                      {Number(p.expected) !== Number(due.data?.amount)
                        ? ` · ${naira(p.expected)}`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
          </div>
        }
      />

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {due.data.name}</DialogTitle>
            <DialogDescription>
              Started {shortDate(due.data.starts_on)}. Changing the amount only affects the period
              you pick and the ones after it; earlier periods keep their price.
            </DialogDescription>
          </DialogHeader>
          <EditDueForm
            initial={{
              name: due.data.name,
              notes: due.data.notes ?? "",
              penalty: Number(due.data.penalty_amount ?? 0),
              graceDays: Number(due.data.penalty_grace_days ?? 0),
              active: due.data.active,
              audience: {
                audience: due.data.audience as Audience,
                labels: due.data.audience_labels ?? [],
                branchIds: due.data.audience_branch_ids ?? [],
                memberIds: appliesTo.data?.picked ?? [],
              },
            }}
            orgId={orgId}
            pending={saveDue.isPending}
            onSave={(patch) => saveDue.mutate(patch)}
          />
          <ChangeAmountForm
            current={Number(due.data.amount)}
            periods={periodList
              .filter((p) => !p.is_past)
              .concat(periodList.filter((p) => p.is_past))
              .slice(0, PERIOD_PICKER_LIMIT)}
            pending={changeAmount.isPending}
            onSave={(v) => changeAmount.mutate(v)}
          />
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Collected" value={naira(collected)} tone="good" hint={periodLabel} />
        <StatCard
          label="Still owing"
          value={naira(
            all.reduce((s, m) => s + Math.max(expected - (paidByMember.get(m.id) ?? 0), 0), 0),
          )}
          tone={overdue ? "bad" : "default"}
          hint={overdue ? "This period has passed — overdue" : "For this period"}
        />
        <StatCard label="People paid" value={`${paid.length} of ${all.length}`} tone="accent" />
      </div>

      {all.length === 0 ? (
        <EmptyState
          title="No members yet"
          hint="Add members first, then come back to tick payments."
        />
      ) : (
        <div className="space-y-4">
          <SearchBox value={search} onChange={setSearch} className="max-w-sm" />
          <Tabs defaultValue="notpaid">
            <TabsList>
              <TabsTrigger value="notpaid">
                {overdue ? "Overdue" : "Not paid"} ({find(notPaid).length})
              </TabsTrigger>
              <TabsTrigger value="paid">Paid ({find(paid).length})</TabsTrigger>
              <TabsTrigger value="partial">Part payment ({find(partial).length})</TabsTrigger>
            </TabsList>

            <TabsContent value="notpaid" className="mt-5">
              <MemberList
                members={find(notPaid)}
                tone={overdue ? "bad" : "muted"}
                action={(m) => (
                  <>
                    <RemindButton
                      phone={m.phone}
                      memberName={m.name}
                      orgName={org?.name ?? "your association"}
                      what={`${due.data!.name} (${periodLabel})`}
                      amount={expected}
                    />
                    {isAdmin && (
                      <Button size="sm" onClick={() => setPaying(m)}>
                        Mark paid
                      </Button>
                    )}
                  </>
                )}
                note={() => (overdue ? "Overdue" : "Not paid")}
              />
            </TabsContent>

            <TabsContent value="paid" className="mt-5">
              <MemberList
                members={find(paid)}
                tone="good"
                note={(m) => naira(paidByMember.get(m.id) ?? 0)}
                action={() => <Check className="size-5 text-success" />}
              />
            </TabsContent>

            <TabsContent value="partial" className="mt-5">
              <MemberList
                members={find(partial)}
                tone="muted"
                note={(m) => `${naira(paidByMember.get(m.id) ?? 0)} of ${naira(expected)}`}
                action={(m) => (
                  <>
                    <RemindButton
                      phone={m.phone}
                      memberName={m.name}
                      orgName={org?.name ?? "your association"}
                      what={`${due.data!.name} (${periodLabel})`}
                      amount={Math.max(expected - (paidByMember.get(m.id) ?? 0), 0)}
                    />
                    {isAdmin && (
                      <Button size="sm" variant="outline" onClick={() => setPaying(m)}>
                        Add payment
                      </Button>
                    )}
                  </>
                )}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {paying?.name} · {due.data.name} · {periodLabel}
            </DialogDescription>
          </DialogHeader>
          {paying && (
            <PaymentForm
              defaultAmount={Math.max(expected - (paidByMember.get(paying.id) ?? 0), 0)}
              pending={record.isPending}
              onSubmit={(v) => record.mutate({ memberId: paying.id, ...v })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type DuePatch = {
  name: string;
  notes: string | null;
  penalty_amount: number;
  penalty_grace_days: number;
  active: boolean;
};

function EditDueForm({
  initial,
  orgId,
  pending,
  onSave,
}: {
  initial: {
    name: string;
    notes: string;
    penalty: number;
    graceDays: number;
    active: boolean;
    audience: AudienceValue;
  };
  orgId: string | null;
  pending: boolean;
  onSave: (patch: DuePatch & { audience: AudienceValue }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [notes, setNotes] = useState(initial.notes);
  const [penalty, setPenalty] = useState(String(initial.penalty || ""));
  const [graceDays, setGraceDays] = useState(String(initial.graceDays || ""));
  const [active, setActive] = useState(initial.active ? "yes" : "no");
  const [audience, setAudience] = useState<AudienceValue>(initial.audience);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: name.trim(),
          notes: notes.trim() || null,
          penalty_amount: Number(penalty || 0),
          penalty_grace_days: Number(graceDays || 0),
          active: active === "yes",
          audience,
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="ed-name">Name</Label>
        <Input id="ed-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ed-notes">Notes (optional)</Label>
        <Input id="ed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ed-penalty">Late charge for each missed period (₦, 0 for none)</Label>
        <Input
          id="ed-penalty"
          type="number"
          min="0"
          value={penalty}
          onChange={(e) => setPenalty(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ed-grace">Days after a period ends before the late charge applies</Label>
        <Input
          id="ed-grace"
          type="number"
          min="0"
          value={graceDays}
          onChange={(e) => setGraceDays(e.target.value)}
          placeholder="0"
        />
      </div>
      <DueAudienceFields value={audience} onChange={setAudience} orgId={orgId} />
      <div className="space-y-2">
        <Label>Still collecting this due?</Label>
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes — keep collecting</SelectItem>
            <SelectItem value="no">No — stop this due</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Save changes
      </Button>
    </form>
  );
}

function ChangeAmountForm({
  current,
  periods,
  pending,
  onSave,
}: {
  current: number;
  periods: { period_start: string; label: string; is_current: boolean }[];
  pending: boolean;
  onSave: (v: { amount: number; from: string }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(periods.find((p) => p.is_current)?.period_start ?? "");

  return (
    <form
      className="space-y-4 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (from) onSave({ amount: Number(amount), from });
      }}
    >
      <p className="text-sm font-medium">Change the amount (now {naira(current)})</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ca-amount">New amount (₦)</Label>
          <Input
            id="ca-amount"
            type="number"
            min="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Starting from</Label>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a period" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.period_start} value={p.period_start}>
                  {p.label}
                  {p.is_current ? " (now)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        type="submit"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={pending || !from}
      >
        {pending && <Loader2 className="size-4 animate-spin" />} Save new amount
      </Button>
    </form>
  );
}

function PaymentForm({
  defaultAmount,
  pending,
  onSubmit,
}: {
  defaultAmount: number;
  pending: boolean;
  onSubmit: (v: {
    amount: number;
    date: string;
    note: string;
    method: PaymentMode;
    clientRef: string;
  }) => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PaymentMode>(defaultPaymentMode);
  const [clientRef] = useState(() => crypto.randomUUID());

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ amount: Number(amount || 0), date, note, method, clientRef });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="p-amount">How much did they pay? (₦)</Label>
        <Input
          id="p-amount"
          required
          type="number"
          min="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <PaymentModeFields value={method} onChange={setMethod} />
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
  note?: ((m: Member) => string) | undefined;
  action?: ((m: Member) => React.ReactNode) | undefined;
  tone: "good" | "bad" | "muted";
}) {
  if (members.length === 0) {
    return <EmptyState title="Nobody here" hint="This list is empty for the chosen period." />;
  }
  const noteClass =
    tone === "good"
      ? "text-success"
      : tone === "bad"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      {members.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
            {initials(m.name)}
          </span>
          <span className="min-w-0 flex-1">
            <Link
              to="/members/$memberId"
              params={{ memberId: m.id }}
              className="link block truncate"
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
