import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { friendlyError } from "@/lib/errors";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { naira } from "@/lib/format";
import { frequencyLabels, type Frequency } from "@/lib/periods";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export const Route = createFileRoute("/_authenticated/dues/")({
  head: () => ({
    meta: [
      { title: "Dues — FinSeka" },
      { name: "description", content: "Set regular dues and see who has paid and who has not." },
      { property: "og:title", content: "Dues — FinSeka" },
      { property: "og:description", content: "Monthly, weekly or yearly dues in one place." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DuesPage,
});

function DuesPage() {
  const { orgId, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const dues = useQuery({
    queryKey: ["dues", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dues")
        .select("id, name, amount, frequency, notes, active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dues"
        subtitle="Money everybody pays regularly — monthly dues, levies, daily savings."
        action={
          isAdmin ? (
            <AddDueDialog onDone={() => queryClient.invalidateQueries({ queryKey: ["dues"] })} />
          ) : null
        }
      />

      {dues.isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (dues.data ?? []).length === 0 ? (
        <EmptyState
          title="No dues set yet"
          hint='Create one like "Monthly Dues — ₦1,000" and start ticking who has paid.'
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {(dues.data ?? []).map((d) => (
            <li key={d.id}>
              <Link
                to="/dues/$dueId"
                params={{ dueId: d.id }}
                className="flex items-center gap-4 rounded-3xl border border-border bg-card p-5 shadow-soft transition-colors hover:bg-secondary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg font-semibold">
                    {d.name}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {naira(d.amount)} · {frequencyLabels[d.frequency as Frequency]}
                  </span>
                </span>
                {!d.active && <Badge variant="secondary">Stopped</Badge>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddDueDialog({ onDone }: { onDone: () => void }) {
  const { orgId } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("dues").insert({
        org_id: orgId!,
        name,
        amount: Number(amount || 0),
        frequency,
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Due created");
      setName("");
      setAmount("");
      setNotes("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="gap-2">
          <Plus className="size-4" /> New due
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a due</DialogTitle>
          <DialogDescription>What is it called, how much, and how often?</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="d-name">Name</Label>
            <Input
              id="d-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monthly Dues"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-amount">Amount each person pays (₦)</Label>
            <Input
              id="d-amount"
              required
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
            />
          </div>
          <div className="space-y-2">
            <Label>How often</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(frequencyLabels) as Frequency[]).map((f) => (
                  <SelectItem key={f} value={f}>
                    {frequencyLabels[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-notes">Notes (optional)</Label>
            <Textarea id="d-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save due
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
