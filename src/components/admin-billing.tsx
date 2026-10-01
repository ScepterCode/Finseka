import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Billing } from "@/hooks/useAuth";
import { when } from "@/lib/admin-activity";
import { billingSummary } from "@/lib/billing";
import { friendlyError } from "@/lib/errors";
import { naira, shortDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type OrgBillingDetail = {
  state: Billing;
  provider_email: string | null;
  payments: {
    id: string;
    provider: string;
    provider_ref: string;
    amount: number;
    months: number;
    paid_at: string;
    covers_until: string;
    note: string | null;
    recorded_by_email: string | null;
  }[];
};

const billingLabels: Record<string, string> = {
  trial: "Trial",
  active: "Pro",
  grace: "Overdue",
  read_only: "Ended",
  free: "Free",
};

export function BillingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant={
        status === "read_only"
          ? "destructive"
          : status === "active" || status === "free"
            ? "default"
            : "secondary"
      }
    >
      {billingLabels[status] ?? status}
    </Badge>
  );
}

// Console → organization → Billing: its plan, its payments, and the super admin tools.
export function OrgBillingPanel({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "org-billing", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_org_billing", { _org_id: orgId });
      if (error) throw error;
      return data as unknown as OrgBillingDetail;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });

  const [days, setDays] = useState("14");
  const [trialReason, setTrialReason] = useState("");
  const extend = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_extend_trial", {
        _org_id: orgId,
        _days: Number(days),
        _reason: trialReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Trial extended");
      setTrialReason("");
      refresh();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const [months, setMonths] = useState("1");
  const [amount, setAmount] = useState("5000");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const record = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_record_payment", {
        _org_id: orgId,
        _months: Number(months),
        _amount: Number(amount),
        _reference: reference.trim(),
        _note: note.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded; Pro is on");
      setReference("");
      setNote("");
      refresh();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const [freeReason, setFreeReason] = useState("");
  const setFree = useMutation({
    mutationFn: async (free: boolean) => {
      const { error } = await supabase.rpc("admin_set_free_plan", {
        _org_id: orgId,
        _free: free,
        _reason: freeReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan updated");
      setFreeReason("");
      refresh();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (detail.isLoading) return <Loader2 className="size-5 animate-spin text-primary" />;
  if (detail.isError || !detail.data) {
    return (
      <p className="text-sm text-destructive">
        Billing could not be loaded: {friendlyError(detail.error)}
      </p>
    );
  }
  const d = detail.data;
  const card = "space-y-3 rounded-3xl border border-border bg-card p-5 shadow-soft";

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <BillingBadge status={d.state.status} />
          <span className="text-sm">{billingSummary(d.state)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Trial ends {shortDate(d.state.trial_ends_at)} · paid until{" "}
          {d.state.paid_until ? shortDate(d.state.paid_until) : "—"}
          {d.provider_email && ` · pays at Flutterwave as ${d.provider_email}`}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <form
          className={card}
          onSubmit={(e) => {
            e.preventDefault();
            record.mutate();
          }}
        >
          <h3 className="font-semibold">Record a bank transfer</h3>
          <p className="text-xs text-muted-foreground">
            Turns on Pro for the months paid, after any time already covered.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bp-months">Months</Label>
              <Input
                id="bp-months"
                type="number"
                min={1}
                max={24}
                value={months}
                onChange={(e) => {
                  setMonths(e.target.value);
                  setAmount(String(Number(e.target.value || 0) * d.state.price));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-amount">Amount (₦)</Label>
              <Input
                id="bp-amount"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-ref">Bank reference</Label>
            <Input
              id="bp-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="From the bank alert"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bp-note">Note (optional)</Label>
            <Input id="bp-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" disabled={record.isPending || !Number(amount) || !Number(months)}>
            {record.isPending && <Loader2 className="size-4 animate-spin" />} Record payment
          </Button>
        </form>

        <form
          className={card}
          onSubmit={(e) => {
            e.preventDefault();
            extend.mutate();
          }}
        >
          <h3 className="font-semibold">Extend the trial</h3>
          <div className="space-y-1.5">
            <Label htmlFor="tr-days">Extra days</Label>
            <Input
              id="tr-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-reason">Why?</Label>
            <Input
              id="tr-reason"
              value={trialReason}
              onChange={(e) => setTrialReason(e.target.value)}
              placeholder="Asked for more time to set up"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={extend.isPending || trialReason.trim().length < 3}
          >
            {extend.isPending && <Loader2 className="size-4 animate-spin" />} Extend trial
          </Button>
        </form>

        <div className={card}>
          <h3 className="font-semibold">Free plan</h3>
          <p className="text-xs text-muted-foreground">
            {d.state.free_plan
              ? "This organization uses FinSeka for free, whatever its trial or payments."
              : "For partners or special cases: FinSeka at no charge, until you turn it off."}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="fp-reason">Why?</Label>
            <Input
              id="fp-reason"
              value={freeReason}
              onChange={(e) => setFreeReason(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={setFree.isPending || freeReason.trim().length < 3}
            onClick={() => setFree.mutate(!d.state.free_plan)}
          >
            {setFree.isPending && <Loader2 className="size-4 animate-spin" />}
            {d.state.free_plan ? "End the free plan" : "Give a free plan"}
          </Button>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-semibold">Payments</h3>
        {d.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {d.payments.map((p) => (
              <li key={p.id} className="py-2">
                {naira(p.amount)} · {p.months} month{p.months === 1 ? "" : "s"} ·{" "}
                {p.provider === "flutterwave"
                  ? `Flutterwave #${p.provider_ref}`
                  : `bank transfer ${p.provider_ref}`}
                {p.note && <span className="text-muted-foreground"> — {p.note}</span>}
                <span className="block text-xs text-muted-foreground">
                  {when(p.paid_at)} · covers to {shortDate(p.covers_until)}
                  {p.recorded_by_email && ` · recorded by ${p.recorded_by_email}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
