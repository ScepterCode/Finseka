import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { friendlyError } from "@/lib/errors";

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { naira, shortDate, todayIso } from "@/lib/format";
import { paymentModeText } from "@/lib/methods";
import { EmptyState, PageHeader, StatCard } from "@/components/page-parts";
import { PaymentModeFields } from "@/components/method-select";
import { defaultPaymentMode, type PaymentMode } from "@/lib/methods";
import { RemindButton } from "@/components/remind-button";
import { SearchBox } from "@/components/search-box";
import { matchesPerson } from "@/lib/search";
import { ContributionPeopleDialog } from "@/components/contribution-people-dialog";
import { AddPledgeDialog, PledgeStats, PledgeTable } from "@/components/pledges";
import { usePledges } from "@/lib/pledges";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmButton, ConfirmDialog } from "@/components/confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { CommitteePicker } from "@/components/committee-picker";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortHead } from "@/components/sort-head";
import {
  OwingAmount,
  PayStatusBadge,
  RegisterList,
  RegisterSortSelect,
} from "@/components/payment-register";
import {
  countByFilter,
  defaultDir,
  matchesFilter,
  payStatus,
  sortRegister,
  type RegisterFilter,
  type RegisterSort,
  type SortDir,
} from "@/lib/register";

export const Route = createFileRoute("/_authenticated/contributions/$contributionId")({
  head: () => ({
    meta: [
      { title: "Contribution tracker — FinSeka" },
      {
        name: "description",
        content: "See who paid this contribution, event budget and spending.",
      },
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

function ContributionDetail() {
  const { contributionId } = Route.useParams();
  const { orgId, isAdmin, org } = useAuth();
  const qc = useQueryClient();
  const [paying, setPaying] = useState<Person | null>(null);
  const [filter, setFilter] = useState<RegisterFilter>("all");
  // Not paid first: the people an admin is chasing.
  const [sort, setSort] = useState<RegisterSort>("status");
  const [dir, setDir] = useState<SortDir>("asc");
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [addingExpense, setAddingExpense] = useState(false);
  const pledges = usePledges({ contributionId });

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
      const data = await fetchAll((from, to) =>
        supabase
          .from("contribution_members")
          .select("member_id, members(id, name, phone)")
          .eq("contribution_id", contributionId)
          .order("id")
          .range(from, to),
      );
      return (data ?? [])
        .map((r) => r.members as Person | null)
        .filter((m): m is Person => !!m)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const payments = useQuery({
    queryKey: ["contribution-payments", contributionId],
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase
          .from("contribution_payments")
          .select("id, member_id, amount, paid_at, note, method, channel, reference")
          .eq("contribution_id", contributionId)
          .is("voided_at", null)
          .order("paid_at", { ascending: false })
          .order("id")
          .range(from, to),
      );
      return data;
    },
  });

  const expenses = useQuery({
    queryKey: ["contribution-expenses", contributionId],
    queryFn: async () => {
      const data = await fetchAll((from, to) =>
        supabase
          .from("contribution_expenses")
          .select("id, description, amount, method, channel, reference, spent_at")
          .eq("contribution_id", contributionId)
          .order("spent_at", { ascending: false })
          .order("id")
          .range(from, to),
      );
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
      method: PaymentMode;
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
          channel: i.method.channel,
          reference: i.method.reference || null,
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
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const close = useMutation({
    mutationFn: async (closed: boolean) => {
      const { error } = await supabase
        .from("contributions")
        .update({ closed })
        .eq("id", contributionId);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const [editing, setEditing] = useState(false);
  // Everyone who can be put on the committee (loaded when the edit form opens).
  const allMembers = useQuery({
    queryKey: ["members", orgId, "active-names"],
    enabled: !!orgId && isAdmin && editing,
    queryFn: () =>
      fetchAll((from, to) =>
        supabase
          .from("members")
          .select("id, name, phone")
          .eq("active", true)
          .order("name")
          .order("id")
          .range(from, to),
      ),
  });
  const saveDetails = useMutation({
    mutationFn: async (patch: ContributionPatch) => {
      const { error } = await supabase.from("contributions").update(patch).eq("id", contributionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contribution updated");
      setEditing(false);
      refresh();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const addExpense = useMutation({
    mutationFn: async (i: {
      description: string;
      amount: number;
      date: string;
      method: PaymentMode;
    }) => {
      const { error } = await supabase.from("contribution_expenses").insert({
        org_id: orgId!,
        contribution_id: contributionId,
        description: i.description,
        amount: i.amount,
        spent_at: i.date,
        channel: i.method.channel,
        reference: i.method.reference || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Spending added");
      setAddingExpense(false);
      refresh();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const removeExpense = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contribution_expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(friendlyError(e)),
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
    onError: (e: Error) => toast.error(friendlyError(e)),
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
    return {
      id: m.id,
      name: m.name,
      phone: m.phone,
      person: m,
      paid,
      owing: c.mandatory ? Math.max(expected - paid, 0) : 0,
      date: last?.paid_at ?? null,
      method: last?.method ?? null,
      channel: last?.channel ?? null,
      reference: last?.reference ?? null,
      status: payStatus(paid, expected, c.mandatory),
    };
  });
  type Row = (typeof rows)[number];

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

  const searched = rows.filter((r) => matchesPerson(search, r.name, r.phone));
  const counts = countByFilter(searched);
  const shown = sortRegister(
    searched.filter((r) => matchesFilter(r.status, filter)),
    sort,
    dir,
  );
  const sortBy = (next: RegisterSort) => {
    if (next === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(next);
      setDir(defaultDir(next));
    }
  };

  // Remind anyone who still owes; while it is open an admin can record a payment for anyone not
  // fully paid (anyone at all when there is no set amount).
  const actions = (r: Row) => {
    const remind = c.mandatory && r.owing > 0;
    const pay = isAdmin && !c.closed && r.status !== "paid";
    if (!remind && !pay) return null;
    return (
      <>
        {remind && (
          <RemindButton
            phone={r.phone}
            memberName={r.name}
            orgName={org?.name ?? "your association"}
            what={c.name}
            amount={r.owing}
          />
        )}
        {pay && (
          <Button
            size="sm"
            variant={r.paid > 0 ? "outline" : "default"}
            onClick={() => setPaying(r.person)}
          >
            {r.paid > 0 ? "Add payment" : "Mark paid"}
          </Button>
        )}
      </>
    );
  };

  const total = Math.max(all.length, 1);

  return (
    <div className="space-y-8">
      <Button asChild variant="outline" size="sm" className="gap-2">
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
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
            {isAdmin && !c.expenses_posted ? (
              <Button variant="outline" onClick={() => close.mutate(!c.closed)}>
                {c.closed ? "Reopen" : "Close contribution"}
              </Button>
            ) : c.closed ? (
              <Badge variant="secondary">Closed</Badge>
            ) : null}
          </div>
        }
      />

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {c.name}</DialogTitle>
            <DialogDescription>
              {c.mandatory
                ? `The amount each person pays (${naira(expected)}) and whether it is compulsory cannot be changed, because that would rewrite what people owe.`
                : "Whether it is compulsory cannot be changed, because that would rewrite what people owe."}
            </DialogDescription>
          </DialogHeader>
          <EditContributionForm
            initial={{
              name: c.name,
              reason: c.reason ?? "",
              dueDate: c.due_date ?? "",
              budget: c.budget_amount == null ? "" : String(c.budget_amount),
              target: c.target_amount == null ? "" : String(c.target_amount),
              acceptsPledges: c.accepts_pledges,
              committee,
            }}
            members={allMembers.data ?? []}
            pending={saveDetails.isPending}
            onSave={(patch) => saveDetails.mutate(patch)}
          />
        </DialogContent>
      </Dialog>

      {overdue && unpaidCount > 0 && (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-3 text-sm font-medium text-destructive">
          Due date has passed — {unpaidCount} people have not paid yet.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Collected" value={naira(collected)} tone="good" />
        <StatCard label="Target" value={naira(target)} tone="accent" />
        <StatCard
          label="Not paid"
          value={`${unpaidCount} of ${all.length}`}
          tone={overdue ? "bad" : "default"}
        />
      </div>

      <div className="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-soft">
        <div>
          <Progress value={pct} />
          <p className="mt-2 text-sm text-muted-foreground">
            {Math.round(pct)}% of target collected
          </p>
        </div>
        <div>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-success" style={{ width: `${(paidCount / total) * 100}%` }} />
            <div className="bg-accent" style={{ width: `${(partCount / total) * 100}%` }} />
            <div
              className="bg-destructive/70"
              style={{ width: `${(unpaidCount / total) * 100}%` }}
            />
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
          {isAdmin && !c.closed && (
            <ContributionPeopleDialog
              contributionId={contributionId}
              orgId={orgId!}
              picked={all.map((p) => p.id)}
              paidIds={new Set(pays.map((p) => p.member_id))}
              onDone={() => {
                refresh();
                qc.invalidateQueries({ queryKey: ["contribution-members", contributionId] });
              }}
            />
          )}
        </div>
        {all.length === 0 ? (
          <EmptyState title="No members selected" hint="Nobody was picked for this contribution." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <SearchBox value={search} onChange={setSearch} className="w-full sm:w-64" />
              <div className="max-w-full overflow-x-auto">
                <Tabs value={filter} onValueChange={(v) => setFilter(v as RegisterFilter)}>
                  <TabsList>
                    <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                    <TabsTrigger value="unpaid">
                      {overdue ? "Overdue" : "Not paid"} ({counts.unpaid})
                    </TabsTrigger>
                    {c.mandatory && <TabsTrigger value="part">Part ({counts.part})</TabsTrigger>}
                    <TabsTrigger value="paid">
                      {c.mandatory ? "Paid" : "Gave"} ({counts.paid})
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {isMobile && (
                <RegisterSortSelect
                  sort={sort}
                  dir={dir}
                  showOwing={c.mandatory}
                  onChange={(s, d) => {
                    setSort(s);
                    setDir(d);
                  }}
                />
              )}
            </div>
            {shown.length === 0 ? (
              <EmptyState title="Nobody here" hint="Nobody matches the search or tab you picked." />
            ) : isMobile ? (
              <RegisterList rows={shown} overdue={overdue} actions={actions} />
            ) : (
              <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <SortHead
                        label="Name"
                        col="name"
                        className="pl-5"
                        sort={sort}
                        dir={dir}
                        onSort={sortBy}
                      />
                      <SortHead label="Status" col="status" sort={sort} dir={dir} onSort={sortBy} />
                      <SortHead
                        label="Paid"
                        col="paid"
                        right
                        sort={sort}
                        dir={dir}
                        onSort={sortBy}
                      />
                      {c.mandatory && (
                        <SortHead
                          label="Owing"
                          col="owing"
                          right
                          sort={sort}
                          dir={dir}
                          onSort={sortBy}
                        />
                      )}
                      <SortHead
                        label="Date paid"
                        col="date"
                        sort={sort}
                        dir={dir}
                        onSort={sortBy}
                      />
                      <TableHead>How</TableHead>
                      <TableHead className="pr-5">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-64 py-2.5 pl-5">
                          <Link
                            to="/members/$memberId"
                            params={{ memberId: r.id }}
                            className="link block truncate font-medium"
                          >
                            {r.name}
                          </Link>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <PayStatusBadge status={r.status} overdue={overdue} />
                        </TableCell>
                        <TableCell className="py-2.5 text-right tabular-nums">
                          {r.paid > 0 ? naira(r.paid) : "—"}
                        </TableCell>
                        {c.mandatory && (
                          <TableCell className="py-2.5 text-right">
                            <OwingAmount value={r.owing} />
                          </TableCell>
                        )}
                        <TableCell className="whitespace-nowrap py-2.5 text-muted-foreground">
                          {r.date ? shortDate(r.date) : "—"}
                        </TableCell>
                        <TableCell className="py-2.5">
                          {r.method ? (
                            <Badge variant="outline">
                              {paymentModeText(r.channel, r.reference, r.method)}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 pr-5">
                          <span className="flex justify-end gap-2">{actions(r)}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </section>

      {c.accepts_pledges && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Pledges & gifts</h2>
              <p className="text-sm text-muted-foreground">
                Promises towards {c.name}, from members or anyone else. Not counted as debts, and
                kept apart from the payments above.
              </p>
            </div>
            {isAdmin && !c.closed && (
              <AddPledgeDialog
                target={{ kind: "contribution", id: c.id, name: c.name }}
                size="sm"
              />
            )}
          </div>
          <PledgeStats pledges={pledges.data ?? []} />
          <PledgeTable pledges={pledges.data ?? []} emptyHint="No pledges for this yet." />
        </section>
      )}

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
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Committee</p>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {committee.length === 0 ? "Add committee" : "Change"}
              </Button>
            )}
          </div>
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
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.description}</span>
                  <span className="text-xs text-muted-foreground">
                    {shortDate(e.spent_at)} · {paymentModeText(e.channel, e.reference, e.method)}
                  </span>
                </span>
                <span className="font-semibold text-destructive">{naira(Number(e.amount))}</span>
                {isAdmin && !c.expenses_posted && (
                  <ConfirmButton
                    size="icon"
                    variant="outline"
                    className="border-destructive/40"
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
              {postExpenses.isPending && <Loader2 className="size-4 animate-spin" />} Close event &
              post to ledger
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
            <DialogDescription>
              Stays on this event until you post it to the ledger.
            </DialogDescription>
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

function PayForm({
  name,
  defaultAmount,
  pending,
  onSubmit,
}: {
  name: string;
  defaultAmount: number;
  pending: boolean;
  onSubmit: (
    amount: number,
    date: string,
    note: string,
    method: PaymentMode,
    clientRef: string,
  ) => void;
}) {
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PaymentMode>(defaultPaymentMode);
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
        <MoneyInput id="cp-amount" required min={1} value={amount} onChange={setAmount} />
      </div>
      <PaymentModeFields value={method} onChange={setMethod} />
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
        description={`${name} paid ${naira(Number(amount || 0))} by ${paymentModeText(method.channel, method.reference).toLowerCase()}.`}
        confirmLabel="Yes, record it"
        onConfirm={() => onSubmit(Number(amount || 0), date, note, method, clientRef)}
      />
    </form>
  );
}

type ContributionPatch = {
  name: string;
  reason: string | null;
  due_date: string | null;
  budget_amount: number | null;
  target_amount: number | null;
  accepts_pledges: boolean;
  committee: string[];
};

function EditContributionForm({
  initial,
  members,
  pending,
  onSave,
}: {
  initial: {
    name: string;
    reason: string;
    dueDate: string;
    budget: string;
    target: string;
    acceptsPledges: boolean;
    committee: string[];
  };
  members: { id: string; name: string; phone: string | null }[];
  pending: boolean;
  onSave: (patch: ContributionPatch) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [reason, setReason] = useState(initial.reason);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [budget, setBudget] = useState(initial.budget);
  const [target, setTarget] = useState(initial.target);
  const [acceptsPledges, setAcceptsPledges] = useState(initial.acceptsPledges);
  const [committee, setCommittee] = useState(initial.committee);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: name.trim(),
          reason: reason.trim() || null,
          due_date: dueDate || null,
          budget_amount: budget ? Number(budget) : null,
          target_amount: target ? Number(target) : null,
          accepts_pledges: acceptsPledges,
          committee,
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="ec-name">Name</Label>
        <Input id="ec-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ec-reason">Reason (optional)</Label>
        <Input id="ec-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ec-due">Due date (optional)</Label>
        <Input
          id="ec-due"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ec-target">Target to collect (₦, optional)</Label>
        <MoneyInput id="ec-target" min={0} value={target} onChange={setTarget} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ec-budget">Event budget (₦, optional)</Label>
        <MoneyInput id="ec-budget" min={0} value={budget} onChange={setBudget} />
      </div>
      <CommitteePicker value={committee} onChange={setCommittee} members={members} idPrefix="ec" />
      <label className="flex items-start gap-3 rounded-2xl border border-border px-4 py-3 text-sm">
        <Checkbox checked={acceptsPledges} onCheckedChange={(v) => setAcceptsPledges(v === true)} />
        <span>
          <span className="block font-medium">Take pledges and gifts</span>
          <span className="block text-xs text-muted-foreground">
            Pledges already made stay listed if you turn this off; no new ones can be added.
          </span>
        </span>
      </label>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Save changes
      </Button>
    </form>
  );
}

function ExpenseForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (v: { description: string; amount: number; date: string; method: PaymentMode }) => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMode>(defaultPaymentMode);
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
        <Input
          id="ce-desc"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Canopy hire"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ce-amount">Amount (₦)</Label>
        <MoneyInput id="ce-amount" required min={1} value={amount} onChange={setAmount} />
      </div>
      <PaymentModeFields value={method} onChange={setMethod} label="How was it paid for?" />
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
