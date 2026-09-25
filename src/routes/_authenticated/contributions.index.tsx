import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { naira, shortDate } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/contributions/")({
  head: () => ({
    meta: [
      { title: "Contributions — FinSeka" },
      {
        name: "description",
        content: "One-off contributions like child dedications, building projects and gifts — track who paid.",
      },
      { property: "og:title", content: "Contributions — FinSeka" },
      { property: "og:description", content: "Create a contribution and pick the members." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContributionsPage,
});

function ContributionsPage() {
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const contributions = useQuery({
    queryKey: ["contributions", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select(
          "id, name, reason, amount_per_person, target_amount, due_date, closed, mandatory, contribution_members(member_id), contribution_payments(amount, member_id)",
        )
        // Filters the embedded payments only; cancelled payments do not count.
        .is("contribution_payments.voided_at", null)
        .order("created_at", { ascending: false });
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
        .select("id, name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Contributions"
        subtitle="For things that come up — child dedications, building projects, gifts."
        action={
          isAdmin ? (
            <NewContributionDialog
              members={members.data ?? []}
              onDone={() => queryClient.invalidateQueries({ queryKey: ["contributions"] })}
            />
          ) : null
        }
      />

      {contributions.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (contributions.data ?? []).length === 0 ? (
        <EmptyState
          title="No contributions yet"
          hint='Example: "School building project — ₦2,000 each — due March 30".'
        />
      ) : (
        <ul className="grid gap-4">
          {(contributions.data ?? []).map((c) => {
            const selected = (c.contribution_members as { member_id: string }[]).length;
            const payments = c.contribution_payments as { amount: number; member_id: string }[];
            const paidPeople = new Set(payments.map((p) => p.member_id)).size;
            const collected = payments.reduce((s, p) => s + Number(p.amount), 0);
            const target =
              Number(c.target_amount ?? 0) || Number(c.amount_per_person) * selected || 0;
            const pct = target > 0 ? Math.min((collected / target) * 100, 100) : 0;

            return (
              <li key={c.id}>
                <Link
                  to="/contributions/$contributionId"
                  params={{ contributionId: c.id }}
                  className="block rounded-3xl border border-border bg-card p-5 shadow-soft transition-colors hover:bg-secondary"
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-lg font-semibold">{c.name}</p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {c.reason || "No reason added"}
                      </p>
                    </div>
                    <Badge variant="outline">{c.mandatory ? "Compulsory" : "Freewill"}</Badge>
                    {c.closed ? (
                      <Badge variant="secondary">Closed</Badge>
                    ) : c.due_date ? (
                      <Badge variant="outline">Due {shortDate(c.due_date)}</Badge>
                    ) : null}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-4 space-y-2">
                    <Progress value={pct} />
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold text-success">{naira(collected)}</span> of{" "}
                      {naira(target)} · {paidPeople}/{selected} people paid
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NewContributionDialog({
  members,
  onDone,
}: {
  members: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { orgId } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [mandatory, setMandatory] = useState(true);
  const [budget, setBudget] = useState("");
  const [committee, setCommittee] = useState<string[]>([]);

  const allPicked = picked.length === members.length && members.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .insert({
          org_id: orgId!,
          name,
          reason: reason || null,
          amount_per_person: Number(amount || 0),
          target_amount: target ? Number(target) : null,
          due_date: dueDate || null,
          mandatory,
          budget_amount: budget ? Number(budget) : null,
          committee,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (picked.length > 0) {
        const { error: linkError } = await supabase.from("contribution_members").insert(
          picked.map((memberId) => ({
            org_id: orgId!,
            contribution_id: data.id,
            member_id: memberId,
          })),
        );
        if (linkError) throw linkError;
      }
    },
    onSuccess: () => {
      toast.success("Contribution created");
      setName("");
      setReason("");
      setAmount("");
      setTarget("");
      setDueDate("");
      setPicked([]);
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="gap-2">
          <Plus className="size-4" /> New contribution
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New contribution</DialogTitle>
          <DialogDescription>Name it, say how much each person pays, pick people.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Baby Ada's dedication"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-reason">Reason</Label>
            <Textarea id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-amount">Each person pays (₦)</Label>
              <Input
                id="c-amount"
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="2000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-target">Target total (₦, optional)</Label>
              <Input
                id="c-target"
                type="number"
                min="0"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-due">Due date (optional)</Label>
            <Input
              id="c-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={mandatory ? "default" : "outline"} onClick={() => setMandatory(true)}>
                Compulsory
              </Button>
              <Button type="button" variant={!mandatory ? "default" : "outline"} onClick={() => setMandatory(false)}>
                Freewill
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {mandatory ? "Everyone picked must pay the amount." : "People give what they can — nobody is owing."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-budget">Event budget (₦, optional)</Label>
            <Input
              id="c-budget"
              type="number"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="How much the committee plans to spend"
            />
          </div>
          <div className="space-y-2">
            <Label>Committee ({committee.length} picked)</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-2xl border border-border p-3">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm">
                  <Checkbox
                    checked={committee.includes(m.name)}
                    onCheckedChange={(v) =>
                      setCommittee((prev) => (v ? [...prev, m.name] : prev.filter((n) => n !== m.name)))
                    }
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Who is contributing? ({picked.length} picked)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPicked(allPicked ? [] : members.map((m) => m.id))}
              >
                {allPicked ? "Clear all" : "Select everybody"}
              </Button>
            </div>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-2xl border border-border p-3">
              {members.length === 0 && (
                <p className="text-sm text-muted-foreground">Add members first.</p>
              )}
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm">
                  <Checkbox
                    checked={picked.includes(m.id)}
                    onCheckedChange={(v) =>
                      setPicked((prev) =>
                        v ? [...prev, m.id] : prev.filter((id) => id !== m.id),
                      )
                    }
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Create contribution
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
