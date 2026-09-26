import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { naira, shortDate, initials } from "@/lib/format";
import { methodShort } from "@/lib/methods";
import { currentPeriod, periodOptions, type Frequency } from "@/lib/periods";
import { fetchMemberStanding } from "@/lib/totals";
import { PageHeader, StatCard, EmptyState } from "@/components/page-parts";
import { TagPicker } from "@/routes/_authenticated/members.index";
import { ReasonDialog } from "@/components/reason-dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_authenticated/members/$memberId")({
  head: () => ({
    meta: [
      { title: "Member profile — FinSeka" },
      { name: "description", content: "Everything this member has paid and what they still owe." },
      { property: "og:title", content: "Member profile — FinSeka" },
      { property: "og:description", content: "Payment history for one member." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MemberProfile,
});

function MemberProfile() {
  const { memberId } = Route.useParams();
  const { isAdmin, orgId } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const member = useQuery({
    queryKey: ["member", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name, phone, active, tags, branch_id, branches(name)")
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const dues = useQuery({
    queryKey: ["dues-for-member", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dues")
        .select("id, name, amount, frequency, penalty_amount, active")
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const duePayments = useQuery({
    queryKey: ["member-due-payments", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("due_payments")
        .select(
          "id, due_id, amount, paid_at, period_label, method, note, voided_at, void_reason, dues(name)",
        )
        .eq("member_id", memberId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // What this member owes, worked out by the database with the same rules as the dashboard.
  const standing = useQuery({
    queryKey: ["member-standing", memberId],
    queryFn: () => fetchMemberStanding(memberId),
  });

  const obligations = useQuery({
    queryKey: ["member-contributions", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contribution_members")
        .select("contribution_id")
        .eq("member_id", memberId);
      if (error) throw error;
      return (data ?? []).map((r) => r.contribution_id);
    },
  });

  const contributions = useQuery({
    queryKey: ["contributions-for-member", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("id, name, amount_per_person, due_date, closed, mandatory");
      if (error) throw error;
      return data;
    },
  });

  const contribPayments = useQuery({
    queryKey: ["member-contrib-payments", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contribution_payments")
        .select(
          "id, contribution_id, amount, paid_at, method, note, voided_at, void_reason, contributions(name)",
        )
        .eq("member_id", memberId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const branches = useQuery({
    queryKey: ["branches", orgId],
    enabled: !!orgId && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async (patch: MemberPatch) => {
      const { error } = await supabase.from("members").update(patch).eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member updated");
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["member", memberId] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Payments are never deleted: cancelling keeps the record and reverses it in the ledger.
  const [cancelling, setCancelling] = useState<{
    kind: "due" | "contribution";
    id: string;
    label: string;
  } | null>(null);
  const cancelPayment = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("void_payment", {
        _kind: cancelling!.kind,
        _payment_id: cancelling!.id,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment cancelled and reversed in the ledger");
      setCancelling(null);
      for (const key of [
        "member-due-payments",
        "member-contrib-payments",
        "member-standing",
        "due-payments",
        "contribution-payments",
        "ledger",
        "ledger-balance",
        "dashboard",
        "reports",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading =
    member.isLoading ||
    dues.isLoading ||
    duePayments.isLoading ||
    contributions.isLoading ||
    contribPayments.isLoading ||
    obligations.isLoading ||
    standing.isLoading;

  if (loading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!member.data) {
    return (
      <EmptyState
        title="Member not found"
        hint="This person may have been removed from your list."
        action={
          <Button asChild variant="outline">
            <Link to="/members">Back to members</Link>
          </Button>
        }
      />
    );
  }

  // Cancelled payments stay visible in the history but never count towards totals.
  const allDuePayments = duePayments.data ?? [];
  const allContribPayments = contribPayments.data ?? [];
  const paymentsByDue = allDuePayments.filter((p) => !p.voided_at);
  const cPayments = allContribPayments.filter((p) => !p.voided_at);
  const pickedIds = new Set(obligations.data ?? []);

  const lines = standing.data ?? [];

  // ---- Dues standing, period by period ----
  const dueRows = (dues.data ?? []).map((d) => {
    const frequency = d.frequency as Frequency;
    const order = periodOptions(frequency);
    const periodRows = lines
      .filter((l) => l.kind === "due" && l.ref_id === d.id)
      .sort((a, b) => order.indexOf(a.period_label ?? "") - order.indexOf(b.period_label ?? ""))
      .map((l) => ({
        period: l.period_label ?? "",
        paid: l.paid,
        short: l.short,
        latePenalty: l.penalty,
        current: l.is_current,
        status:
          l.short === 0 ? "Paid" : l.paid > 0 ? "Part payment" : l.is_past ? "Overdue" : "Not paid",
      }));

    return {
      id: d.id,
      name: d.name,
      expected: Number(d.amount),
      frequency,
      currentPeriodLabel: currentPeriod(frequency),
      currentStatus: periodRows.find((p) => p.current)?.status ?? "Not paid",
      arrears: periodRows.reduce((s, p) => s + p.short, 0),
      penalties: periodRows.reduce((s, p) => s + p.latePenalty, 0),
      periodRows,
    };
  });

  // ---- Contribution standing ----
  // Only compulsory contributions can be owed; freewill ones just show what was given.
  const contribRows = (contributions.data ?? [])
    .map((c) => {
      const paid = cPayments
        .filter((p) => p.contribution_id === c.id)
        .reduce((s, p) => s + Number(p.amount), 0);
      const obliged = pickedIds.has(c.id);
      const line = lines.find((l) => l.kind === "contribution" && l.ref_id === c.id);
      const expected = line?.expected ?? 0;
      const owing = line?.short ?? 0;
      return {
        id: c.id,
        name: c.name,
        kind: obliged && c.mandatory ? "Compulsory" : obliged ? "Freewill" : "Gave freely",
        obliged,
        expected,
        paid,
        owing,
        closed: c.closed,
        status: line
          ? owing === 0
            ? "Paid"
            : paid > 0
              ? "Part payment"
              : "Not paid"
          : paid > 0
            ? "Gave freely"
            : "—",
      };
    })
    .filter((c) => c.obliged || c.paid > 0);

  const duesPaidTotal = paymentsByDue.reduce((s, p) => s + Number(p.amount), 0);
  const contribPaidTotal = cPayments.reduce((s, p) => s + Number(p.amount), 0);
  const totalPaid = duesPaidTotal + contribPaidTotal;
  const duesOwing = dueRows.reduce((s, d) => s + d.arrears + d.penalties, 0);
  const contribOwing = contribRows.reduce((s, c) => s + c.owing, 0);
  const totalOwing = duesOwing + contribOwing;
  const tags = (member.data.tags as string[] | null) ?? [];

  const history = [
    ...allDuePayments.map((p) => ({
      id: p.id,
      label: (p.dues as { name: string } | null)?.name ?? "Dues",
      detail: `${p.period_label} · ${methodShort(p.method)}`,
      amount: Number(p.amount),
      date: p.paid_at,
      kind: "Dues",
      payKind: "due" as const,
      voided: !!p.voided_at,
      voidReason: p.void_reason,
    })),
    ...allContribPayments.map((p) => ({
      id: p.id,
      label: (p.contributions as { name: string } | null)?.name ?? "Contribution",
      detail: `${methodShort(p.method)}${p.note ? ` · ${p.note}` : ""}`,
      amount: Number(p.amount),
      date: p.paid_at,
      kind: "Contribution",
      payKind: "contribution" as const,
      voided: !!p.voided_at,
      voidReason: p.void_reason,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-2">
        <Link to="/members">
          <ArrowLeft className="size-4" /> All members
        </Link>
      </Button>

      <PageHeader
        title={member.data.name}
        subtitle={member.data.phone || "No phone saved"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {(member.data.branches as { name: string } | null)?.name ?? "No branch"}
            </Badge>
            <Badge
              className={
                totalOwing > 0 ? "bg-destructive/12 text-destructive" : "bg-success/12 text-success"
              }
              variant="secondary"
            >
              {totalOwing > 0 ? `Owing ${naira(totalOwing)}` : "Good standing"}
            </Badge>
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
          </div>
        }
      />

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="bg-primary-soft text-primary">
              {t}
            </Badge>
          ))}
          {!member.data.active && <Badge variant="outline">Not active</Badge>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total paid to the group"
          value={naira(totalPaid)}
          tone="good"
          hint="All time"
        />
        <StatCard
          label="Owing now"
          value={naira(totalOwing)}
          tone={totalOwing > 0 ? "bad" : "default"}
          hint={totalOwing > 0 ? "Dues, late charges and contributions" : "Nothing outstanding"}
        />
        <StatCard
          label="Paid in dues / contributions"
          value={`${naira(duesPaidTotal)} / ${naira(contribPaidTotal)}`}
          tone="accent"
        />
      </div>

      <Tabs defaultValue="dues">
        <TabsList className="flex-wrap">
          <TabsTrigger value="dues">Dues to pay ({dueRows.length})</TabsTrigger>
          <TabsTrigger value="contributions">Contributions ({contribRows.length})</TabsTrigger>
          <TabsTrigger value="history">Payment history ({history.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="dues" className="mt-5 space-y-5">
          {dueRows.length === 0 ? (
            <EmptyState title="No dues set" hint="Create a due and it will show up here." />
          ) : (
            dueRows.map((d) => (
              <div
                key={d.id}
                className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft"
              >
                <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-semibold">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {naira(d.expected)} each{" "}
                      {d.frequency === "yearly"
                        ? "year"
                        : d.frequency === "weekly"
                          ? "week"
                          : d.frequency === "daily"
                            ? "day"
                            : "month"}{" "}
                      · now: {d.currentPeriodLabel}
                    </p>
                  </div>
                  <StatusPill status={d.currentStatus} />
                  {d.arrears + d.penalties > 0 && (
                    <Badge variant="secondary" className="bg-destructive/12 text-destructive">
                      Owing {naira(d.arrears + d.penalties)}
                      {d.penalties > 0 ? ` (incl. ${naira(d.penalties)} late charge)` : ""}
                    </Badge>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2.5">Period</th>
                      <th className="px-5 py-2.5">Status</th>
                      <th className="px-5 py-2.5 text-right">Paid</th>
                      <th className="px-5 py-2.5 text-right">Still owing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.periodRows.map((p) => (
                      <tr key={p.period}>
                        <td className="px-5 py-2.5 font-medium">{p.period}</td>
                        <td className="px-5 py-2.5">
                          <StatusPill status={p.status} />
                        </td>
                        <td className="px-5 py-2.5 text-right">{p.paid ? naira(p.paid) : "—"}</td>
                        <td className="px-5 py-2.5 text-right text-destructive">
                          {p.short + p.latePenalty > 0 ? naira(p.short + p.latePenalty) : "—"}
                          {p.latePenalty > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              includes {naira(p.latePenalty)} late charge
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-border px-5 py-3">
                  <Button asChild variant="ghost" size="sm" className="px-0">
                    <Link to="/dues/$dueId" params={{ dueId: d.id }}>
                      Open this due
                    </Link>
                  </Button>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="contributions" className="mt-5">
          {contribRows.length === 0 ? (
            <EmptyState
              title="No contributions yet"
              hint="Once this person is added to a contribution it shows here."
            />
          ) : (
            <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Contribution</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Paid</th>
                    <th className="px-5 py-3 text-right">Owing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contribRows.map((c) => (
                    <tr key={c.id}>
                      <td className="px-5 py-3 font-medium">
                        <Link
                          to="/contributions/$contributionId"
                          params={{ contributionId: c.id }}
                          className="hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{c.kind}</td>
                      <td className="px-5 py-3">
                        <StatusPill status={c.status} />
                      </td>
                      <td className="px-5 py-3 text-right text-success">
                        {c.paid ? naira(c.paid) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-destructive">
                        {c.owing ? naira(c.owing) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-5">
          {history.length === 0 ? (
            <EmptyState
              title="Nothing paid yet"
              hint="Record a payment from Dues or Contributions."
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
              {history.map((h) => (
                <li key={h.kind + h.id} className="flex items-center gap-4 px-5 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                    {initials(h.label)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate font-medium ${h.voided ? "line-through opacity-60" : ""}`}
                    >
                      {h.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {h.kind}
                      {h.detail ? ` · ${h.detail}` : ""} · {shortDate(h.date)}
                    </span>
                    {h.voided && (
                      <span className="block truncate text-xs text-destructive">
                        Cancelled{h.voidReason ? `: ${h.voidReason}` : ""}
                      </span>
                    )}
                  </span>
                  <span
                    className={`font-semibold ${h.voided ? "text-muted-foreground line-through" : "text-success"}`}
                  >
                    {naira(h.amount)}
                  </span>
                  {isAdmin && !h.voided && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() =>
                        setCancelling({
                          kind: h.payKind,
                          id: h.id,
                          label: `${naira(h.amount)} for ${h.label} (${shortDate(h.date)})`,
                        })
                      }
                    >
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {member.data.name}</DialogTitle>
            <DialogDescription>
              Change their details, labels, or whether they are still active. Past payments keep the
              name they were recorded with.
            </DialogDescription>
          </DialogHeader>
          <EditMemberForm
            initial={{
              name: member.data.name,
              phone: member.data.phone ?? "",
              branchId: member.data.branch_id,
              tags,
              active: member.data.active,
            }}
            branches={branches.data ?? []}
            pending={update.isPending}
            onSave={(patch) => update.mutate(patch)}
          />
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this payment?"
        description={`${cancelling?.label ?? ""}. The payment stays in the history, marked as cancelled, and the ledger gets a reversing line. Record the right payment afterwards if needed.`}
        confirmLabel="Yes, cancel it"
        pending={cancelPayment.isPending}
        onConfirm={(reason) => cancelPayment.mutate(reason)}
      />
    </div>
  );
}

type MemberPatch = {
  name: string;
  phone: string | null;
  branch_id: string | null;
  active: boolean;
  tags: string[];
};

function EditMemberForm({
  initial,
  branches,
  pending,
  onSave,
}: {
  initial: {
    name: string;
    phone: string;
    branchId: string | null;
    tags: string[];
    active: boolean;
  };
  branches: { id: string; name: string }[];
  pending: boolean;
  onSave: (patch: MemberPatch) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [branchId, setBranchId] = useState(initial.branchId ?? "none");
  const [tags, setTags] = useState(initial.tags);
  const [active, setActive] = useState(initial.active ? "yes" : "no");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: name.trim(),
          phone: phone.trim() || null,
          branch_id: branchId === "none" ? null : branchId,
          active: active === "yes",
          tags,
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="em-name">Name</Label>
        <Input id="em-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="em-phone">Phone (optional)</Label>
        <Input id="em-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Branch</Label>
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No branch</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Is this person still active?</Label>
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes — still paying</SelectItem>
            <SelectItem value="no">No — no longer paying</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <TagPicker tags={tags} onChange={setTags} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Save changes
      </Button>
    </form>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Paid" || status === "Gave freely"
      ? "bg-success/12 text-success"
      : status === "Overdue"
        ? "bg-destructive/12 text-destructive"
        : status === "Part payment"
          ? "bg-accent/15 text-accent"
          : "bg-secondary text-muted-foreground";
  return (
    <Badge variant="secondary" className={tone}>
      {status}
    </Badge>
  );
}
