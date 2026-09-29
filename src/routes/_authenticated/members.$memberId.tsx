import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Pencil, Wallet } from "lucide-react";
import { toast } from "sonner";

import { friendlyError } from "@/lib/errors";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAuth } from "@/hooks/useAuth";
import { naira, shortDate, initials } from "@/lib/format";
import { paymentModeText } from "@/lib/methods";
import { type Frequency } from "@/lib/periods";

/** Periods shown per due on the profile; the totals always include every period. */
const PERIODS_SHOWN = 12;
import { fetchMemberStanding } from "@/lib/totals";
import { PageHeader, StatCard, EmptyState } from "@/components/page-parts";
import { TagPicker } from "@/routes/_authenticated/members.index";
import { ReasonDialog } from "@/components/reason-dialog";
import { RemindButton } from "@/components/remind-button";
import { MemberStatement } from "@/components/member-statement";
import { MemberPaymentDialog } from "@/components/member-payment-dialog";
import { AUTO, type Debt } from "@/lib/debts";
import { MemberDetailsFields } from "@/components/member-details-fields";
import {
  detailsFromRow,
  detailsList,
  detailsToRow,
  type MemberDetails,
} from "@/lib/member-details";
import { PledgeTable } from "@/components/pledges";
import { usePledges } from "@/lib/pledges";
import { buildStatement } from "@/lib/statement";
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
  const { isAdmin, orgId, org } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  // null = closed; otherwise which debt the payment form starts on (AUTO = oldest first).
  const [paying, setPaying] = useState<string | null>(null);

  const member = useQuery({
    queryKey: ["member", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select(
          "id, name, phone, active, tags, branch_id, joined_on, email, gender, date_of_birth, address, occupation, next_of_kin_name, next_of_kin_phone, branches(name)",
        )
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const dues = useQuery({
    queryKey: ["dues-for-member", memberId],
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase
          .from("dues")
          .select("id, name, amount, frequency, penalty_amount, active")
          .eq("active", true)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      );
      return data;
    },
  });

  const duePayments = useQuery({
    queryKey: ["member-due-payments", memberId],
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase
          .from("due_payments")
          .select(
            "id, due_id, amount, paid_at, period_label, method, channel, reference, note, voided_at, void_reason, dues(name)",
          )
          .eq("member_id", memberId)
          .order("paid_at", { ascending: false })
          .order("id")
          .range(from, to),
      );
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
      const data = await fetchAll((from, to) =>
        supabase
          .from("contribution_members")
          .select("contribution_id")
          .eq("member_id", memberId)
          .order("id")
          .range(from, to),
      );
      return (data ?? []).map((r) => r.contribution_id);
    },
  });

  const contributions = useQuery({
    queryKey: ["contributions-for-member", memberId],
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase
          .from("contributions")
          .select("id, name, amount_per_person, due_date, closed, mandatory")
          .order("id")
          .range(from, to),
      );
      return data;
    },
  });

  const contribPayments = useQuery({
    queryKey: ["member-contrib-payments", memberId],
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase
          .from("contribution_payments")
          .select(
            "id, contribution_id, amount, paid_at, method, channel, reference, note, voided_at, void_reason, contributions(name)",
          )
          .eq("member_id", memberId)
          .order("paid_at", { ascending: false })
          .order("id")
          .range(from, to),
      );
      return data;
    },
  });

  const branches = useQuery({
    queryKey: ["branches", orgId],
    enabled: !!orgId && isAdmin,
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase.from("branches").select("id, name").order("name").order("id").range(from, to),
      );
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
    onError: (e: Error) => toast.error(friendlyError(e)),
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
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const pledges = usePledges({ memberId });

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

  // A failed load is not the same as a missing member: say so, and offer a retry.
  if (member.error) {
    return (
      <EmptyState
        title="Couldn't load this member"
        hint={friendlyError(member.error)}
        action={
          <Button variant="outline" onClick={() => void member.refetch()}>
            Try again
          </Button>
        }
      />
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
    const periodRows = lines
      .filter((l) => l.kind === "due" && l.ref_id === d.id)
      .sort((a, b) => (b.period_start ?? "").localeCompare(a.period_start ?? ""))
      .map((l) => ({
        period: l.period_label ?? "",
        periodStart: l.period_start ?? "",
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
      currentPeriodLabel: periodRows.find((p) => p.current)?.period ?? "",
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

  // Every debt, oldest first — the same order "oldest debts first" pays them in.
  const closedContributions = new Set(
    (contributions.data ?? []).filter((c) => c.closed).map((c) => c.id),
  );
  const debts: Debt[] = lines
    .filter((l) => l.short > 0 && !(l.kind === "contribution" && closedContributions.has(l.ref_id)))
    .sort(
      (a, b) =>
        (a.period_start ?? "9999-12-31").localeCompare(b.period_start ?? "9999-12-31") ||
        (a.kind === b.kind ? 0 : a.kind === "due" ? -1 : 1) ||
        a.ref_name.localeCompare(b.ref_name),
    )
    .map((l): Debt =>
      l.kind === "due"
        ? {
            kind: "due",
            dueId: l.ref_id,
            periodStart: l.period_start ?? "",
            periodLabel: l.period_label ?? "",
            title: `${l.ref_name} — ${l.period_label ?? ""}`,
            owing: l.short,
            penalty: l.penalty,
          }
        : { kind: "contribution", contributionId: l.ref_id, title: l.ref_name, owing: l.short },
    );
  const details = detailsFromRow(member.data);
  const shownDetails = detailsList(details);

  const duesPaidTotal = paymentsByDue.reduce((s, p) => s + Number(p.amount), 0);
  const contribPaidTotal = cPayments.reduce((s, p) => s + Number(p.amount), 0);
  const totalPaid = duesPaidTotal + contribPaidTotal;
  const duesOwing = dueRows.reduce((s, d) => s + d.arrears + d.penalties, 0);
  const contribOwing = contribRows.reduce((s, c) => s + c.owing, 0);
  const totalOwing = duesOwing + contribOwing;
  const tags = (member.data.tags as string[] | null) ?? [];

  const statement = buildStatement(lines, allDuePayments, allContribPayments);

  const history = [
    ...allDuePayments.map((p) => ({
      id: p.id,
      label: (p.dues as { name: string } | null)?.name ?? "Dues",
      detail: `${p.period_label} · ${paymentModeText(p.channel, p.reference, p.method)}`,
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
      detail: `${paymentModeText(p.channel, p.reference, p.method)}${p.note ? ` · ${p.note}` : ""}`,
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
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link to="/members">
          <ArrowLeft className="size-4" /> All members
        </Link>
      </Button>

      <PageHeader
        title={member.data.name}
        subtitle={`${member.data.phone || "No phone saved"} · joined ${shortDate(member.data.joined_on)}`}
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
            <RemindButton
              phone={member.data.phone}
              memberName={member.data.name}
              orgName={org?.name ?? "your association"}
              what={
                contribOwing > 0 && duesOwing > 0
                  ? "your dues and contributions"
                  : contribOwing > 0
                    ? "your contributions"
                    : "your dues"
              }
              amount={totalOwing}
            />
            {isAdmin && debts.length > 0 && (
              <Button size="sm" className="gap-2" onClick={() => setPaying(AUTO)}>
                <Wallet className="size-3.5" /> Record payment
              </Button>
            )}
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

      <Tabs defaultValue="statement">
        <TabsList>
          <TabsTrigger value="statement">Statement</TabsTrigger>
          <TabsTrigger value="dues">Dues to pay ({dueRows.length})</TabsTrigger>
          <TabsTrigger value="contributions">Contributions ({contribRows.length})</TabsTrigger>
          <TabsTrigger value="history">Payment history ({history.length})</TabsTrigger>
          <TabsTrigger value="pledges">Pledges ({pledges.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="statement" className="mt-5">
          <MemberStatement
            entries={statement}
            owing={totalOwing}
            memberName={member.data.name}
            phone={member.data.phone}
            orgName={org?.name ?? "FinSeka"}
          />
        </TabsContent>

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
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-sm">
                    <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5">Period</th>
                        <th className="px-5 py-2.5">Status</th>
                        <th className="px-5 py-2.5 text-right">Paid</th>
                        <th className="px-5 py-2.5 text-right">Still owing</th>
                        {isAdmin && <th className="px-5 py-2.5" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {d.periodRows.slice(0, PERIODS_SHOWN).map((p) => (
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
                          {isAdmin && (
                            <td className="px-5 py-2.5 text-right">
                              {p.short > 0 && (
                                <Button
                                  size="sm"
                                  onClick={() => setPaying(`due:${d.id}:${p.periodStart}`)}
                                >
                                  Pay
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.periodRows.length > PERIODS_SHOWN && (
                  <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
                    Showing the latest {PERIODS_SHOWN} of {d.periodRows.length} periods. The amount
                    owing includes all of them.
                  </p>
                )}
                <div className="border-t border-border px-5 py-3">
                  <Button asChild variant="outline" size="sm">
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
            <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
              <table className="w-full min-w-[32rem] text-sm">
                <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Contribution</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Paid</th>
                    <th className="px-5 py-3 text-right">Owing</th>
                    {isAdmin && <th className="px-5 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contribRows.map((c) => (
                    <tr key={c.id}>
                      <td className="px-5 py-3 font-medium">
                        <Link
                          to="/contributions/$contributionId"
                          params={{ contributionId: c.id }}
                          className="link"
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
                      {isAdmin && (
                        <td className="px-5 py-3 text-right">
                          {c.owing > 0 && !c.closed && (
                            <Button size="sm" onClick={() => setPaying(`contribution:${c.id}`)}>
                              Pay
                            </Button>
                          )}
                        </td>
                      )}
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
                <li
                  key={h.kind + h.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
                >
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
                      variant="outline"
                      className="border-destructive/40 text-destructive"
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
        <TabsContent value="pledges" className="mt-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Pledges are promises, not debts: they are not part of what {member.data.name} owes.
          </p>
          {isAdmin && (
            <p className="text-sm text-muted-foreground">
              To add one, open the{" "}
              <Link to="/pledges" className="link">
                Pledges page
              </Link>{" "}
              or a contribution that takes pledges.
            </p>
          )}
          <PledgeTable
            pledges={pledges.data ?? []}
            showFor
            emptyHint={`${member.data.name} has not made any pledges.`}
          />
        </TabsContent>

        <TabsContent value="details" className="mt-5">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
            {shownDetails.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No extra details saved.
                {isAdmin ? " Tap Edit to add email, address, date of birth and more." : ""}
              </p>
            ) : (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
                {shownDetails.map((x) => (
                  <div key={x.label} className="contents">
                    <dt className="text-muted-foreground">{x.label}</dt>
                    <dd className="break-words font-medium">{x.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
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
              joinedOn: member.data.joined_on,
              tags,
              active: member.data.active,
              details,
            }}
            branches={branches.data ?? []}
            pending={update.isPending}
            onSave={(patch) => update.mutate(patch)}
          />
        </DialogContent>
      </Dialog>

      <MemberPaymentDialog
        orgId={orgId!}
        memberId={memberId}
        memberName={member.data.name}
        debts={debts}
        open={paying !== null}
        preselect={paying ?? AUTO}
        onOpenChange={(o) => !o && setPaying(null)}
      />

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
  joined_on: string;
  active: boolean;
  tags: string[];
} & ReturnType<typeof detailsToRow>;

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
    joinedOn: string;
    tags: string[];
    active: boolean;
    details: MemberDetails;
  };
  branches: { id: string; name: string }[];
  pending: boolean;
  onSave: (patch: MemberPatch) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [branchId, setBranchId] = useState(initial.branchId ?? "none");
  const [joinedOn, setJoinedOn] = useState(initial.joinedOn);
  const [tags, setTags] = useState(initial.tags);
  const [active, setActive] = useState(initial.active ? "yes" : "no");
  const [details, setDetails] = useState(initial.details);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: name.trim(),
          phone: phone.trim() || null,
          branch_id: branchId === "none" ? null : branchId,
          joined_on: joinedOn,
          active: active === "yes",
          tags,
          ...detailsToRow(details),
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
        <Label htmlFor="em-joined">Joined on</Label>
        <Input
          id="em-joined"
          type="date"
          required
          value={joinedOn}
          onChange={(e) => setJoinedOn(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          They owe dues from this date. Changing it changes what they owe.
        </p>
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
      <MemberDetailsFields value={details} onChange={setDetails} idPrefix="em" />
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
