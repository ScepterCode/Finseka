import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { naira, shortDate, initials } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

  const member = useQuery({
    queryKey: ["member", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name, phone, active, branches(name)")
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const duePayments = useQuery({
    queryKey: ["member-due-payments", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("due_payments")
        .select("id, amount, paid_at, period_label, note, dues(name)")
        .eq("member_id", memberId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const contribPayments = useQuery({
    queryKey: ["member-contrib-payments", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contribution_payments")
        .select("id, amount, paid_at, note, contributions(name)")
        .eq("member_id", memberId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const loading = member.isLoading || duePayments.isLoading || contribPayments.isLoading;

  const duesTotal = (duePayments.data ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const contribTotal = (contribPayments.data ?? []).reduce((s, p) => s + Number(p.amount), 0);

  const history = [
    ...(duePayments.data ?? []).map((p) => ({
      id: p.id,
      label: (p.dues as { name: string } | null)?.name ?? "Dues",
      detail: p.period_label,
      amount: Number(p.amount),
      date: p.paid_at,
      kind: "Dues",
    })),
    ...(contribPayments.data ?? []).map((p) => ({
      id: p.id,
      label: (p.contributions as { name: string } | null)?.name ?? "Contribution",
      detail: p.note ?? "",
      amount: Number(p.amount),
      date: p.paid_at,
      kind: "Contribution",
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

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
          <Badge variant="secondary">
            {(member.data.branches as { name: string } | null)?.name ?? "No branch"}
          </Badge>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Paid in dues" value={naira(duesTotal)} tone="good" />
        <StatCard label="Paid in contributions" value={naira(contribTotal)} tone="accent" />
        <StatCard label="Total paid" value={naira(duesTotal + contribTotal)} />
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Payment history</h2>
        {history.length === 0 ? (
          <EmptyState title="Nothing paid yet" hint="Record a payment from Dues or Contributions." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
            {history.map((h) => (
              <li key={h.kind + h.id} className="flex items-center gap-4 px-5 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                  {initials(h.label)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {h.kind}
                    {h.detail ? ` · ${h.detail}` : ""} · {shortDate(h.date)}
                  </span>
                </span>
                <span className="font-semibold text-success">{naira(h.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
