import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { naira, todayIso } from "@/lib/format";
import { defaultPaymentMode, type PaymentMode } from "@/lib/methods";
import { AUTO, debtKey, type Debt } from "@/lib/debts";
import { PaymentModeFields } from "@/components/method-select";
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

type Part = { kind: string; name: string; period: string | null; amount: number };

/**
 * Record a payment on a member's profile: pick one debt to settle (in full or in part),
 * or let the payment go to their oldest debts first.
 */
export function MemberPaymentDialog({
  orgId,
  memberId,
  memberName,
  debts,
  open,
  preselect,
  onOpenChange,
}: {
  orgId: string;
  memberId: string;
  memberName: string;
  /** Oldest first. */
  debts: Debt[];
  open: boolean;
  /** AUTO or a debtKey. */
  preselect: string;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState(AUTO);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState<PaymentMode>(defaultPaymentMode);
  const [note, setNote] = useState("");
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());

  const totalOwing = debts.reduce((s, d) => s + d.owing, 0);
  const debt = debts.find((d) => debtKey(d) === choice) ?? null;
  const owingForChoice = debt ? debt.owing : totalOwing;

  // Fresh form each time it opens, pre-filled with what is owed.
  useEffect(() => {
    if (!open) return;
    const start = debts.some((d) => debtKey(d) === preselect) ? preselect : AUTO;
    const d = debts.find((x) => debtKey(x) === start);
    setChoice(start);
    setAmount(String(d ? d.owing : debts.reduce((s, x) => s + x.owing, 0)));
    setDate(todayIso());
    setMode(defaultPaymentMode);
    setNote("");
    setClientRef(crypto.randomUUID());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when it opens
  }, [open, preselect]);

  const pick = (key: string) => {
    setChoice(key);
    const d = debts.find((x) => debtKey(x) === key);
    setAmount(String(d ? d.owing : totalOwing));
  };

  const value = Number(amount);
  const tooMuch = value > owingForChoice;
  const left = Math.max(owingForChoice - value, 0);

  const save = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!debt) {
        const { data, error } = await supabase.rpc("pay_member_debts", {
          _member_id: memberId,
          _amount: value,
          _paid_at: date,
          _channel: mode.channel,
          _client_ref: clientRef,
          ...(mode.reference.trim() ? { _reference: mode.reference.trim() } : {}),
          ...(note.trim() ? { _note: note.trim() } : {}),
        });
        if (error) throw error;
        const r = data as unknown as { already_saved: boolean; parts: Part[] };
        if (r.already_saved) return "That payment was already saved";
        return `Payment recorded: ${r.parts
          .map((p) => `${p.name}${p.period ? ` ${p.period}` : ""} ${naira(p.amount)}`)
          .join(", ")}`;
      }
      const common = {
        org_id: orgId,
        member_id: memberId,
        amount: value,
        paid_at: date,
        channel: mode.channel,
        reference: mode.reference.trim() || null,
        note: note.trim() || null,
        client_ref: clientRef,
      };
      // client_ref makes a retried save a no-op instead of a second payment.
      const { error } =
        debt.kind === "due"
          ? await supabase.from("due_payments").upsert(
              {
                ...common,
                due_id: debt.dueId,
                period_start: debt.periodStart,
                period_label: debt.periodLabel,
              },
              { onConflict: "client_ref", ignoreDuplicates: true },
            )
          : await supabase
              .from("contribution_payments")
              .upsert(
                { ...common, contribution_id: debt.contributionId },
                { onConflict: "client_ref", ignoreDuplicates: true },
              );
      if (error) throw error;
      return value < debt.owing
        ? `Part payment of ${naira(value)} recorded for ${debt.title}`
        : `${debt.title} paid in full`;
    },
    onSuccess: (message) => {
      toast.success(message);
      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a payment from {memberName}</DialogTitle>
          <DialogDescription>
            They owe {naira(totalOwing)} in all. Pick what this payment is for.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooMuch) save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>What are they paying for?</Label>
            <Select value={choice} onValueChange={pick}>
              <SelectTrigger className="h-auto min-h-10 whitespace-normal text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={AUTO}>
                  Oldest debts first (spread over everything) · {naira(totalOwing)}
                </SelectItem>
                {debts.map((d) => (
                  <SelectItem key={debtKey(d)} value={debtKey(d)}>
                    {d.title} · owes {naira(d.owing)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {debts.length} {debts.length === 1 ? "debt" : "debts"} outstanding.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mp-amount">How much did they pay? (₦)</Label>
            <Input
              id="mp-amount"
              type="number"
              min="1"
              step="any"
              required
              value={amount}
              aria-invalid={tooMuch}
              onChange={(e) => setAmount(e.target.value)}
            />
            {value > 0 && (
              <p
                className={`rounded-xl px-3 py-2 text-sm ${
                  tooMuch
                    ? "bg-destructive/10 text-destructive"
                    : left === 0
                      ? "bg-success/10 text-success"
                      : "bg-accent/10 text-accent"
                }`}
              >
                {tooMuch
                  ? `That is more than the ${naira(owingForChoice)} owed${debt ? " for this" : ""}. Lower the amount${debt ? ", or pick “Oldest debts first” to spread it" : ", or record the extra as a donation in the ledger"}.`
                  : left === 0
                    ? debt
                      ? "This settles it in full."
                      : "This clears everything they owe."
                    : debt
                      ? `Part payment: ${naira(left)} will still be owed on this.`
                      : `Goes to the oldest debts first. ${naira(left)} will still be owed.`}
              </p>
            )}
            {debt?.kind === "due" && debt.penalty > 0 && (
              <p className="text-xs text-muted-foreground">
                This period also has a {naira(debt.penalty)} late charge. It clears once the period
                is paid in full.
              </p>
            )}
          </div>
          <PaymentModeFields value={mode} onChange={setMode} />
          <div className="space-y-2">
            <Label htmlFor="mp-date">Date paid</Label>
            <Input
              id="mp-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-note">Note (optional)</Label>
            <Input id="mp-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={save.isPending || tooMuch || !(value > 0)}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {left > 0 && !tooMuch ? "Save part payment" : "Save payment"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
