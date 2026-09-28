import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { naira, todayIso } from "@/lib/format";
import { defaultPaymentMode, type PaymentMode } from "@/lib/methods";
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

/** One thing a member owes: a due period or a compulsory contribution. */
export type Debt =
  | {
      kind: "due";
      dueId: string;
      periodStart: string;
      periodLabel: string;
      title: string;
      owing: number;
    }
  | { kind: "contribution"; contributionId: string; title: string; owing: number };

/** Record a payment against one specific debt, straight from the member's profile. */
export function DebtPaymentDialog({
  orgId,
  memberId,
  memberName,
  debt,
  onClose,
}: {
  orgId: string;
  memberId: string;
  memberName: string;
  debt: Debt | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState<PaymentMode>(defaultPaymentMode);
  const [note, setNote] = useState("");
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());

  // Fresh form for each debt, pre-filled with what is owed.
  useEffect(() => {
    if (!debt) return;
    setAmount(String(debt.owing));
    setDate(todayIso());
    setMode(defaultPaymentMode);
    setNote("");
    setClientRef(crypto.randomUUID());
  }, [debt]);

  const save = useMutation({
    mutationFn: async () => {
      if (!debt) return;
      const common = {
        org_id: orgId,
        member_id: memberId,
        amount: Number(amount),
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
    },
    onSuccess: () => {
      toast.success(`Payment recorded for ${debt?.title}`);
      onClose();
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
    <Dialog open={!!debt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            {memberName} · {debt?.title} · owing {naira(debt?.owing ?? 0)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="dp-amount">How much did they pay? (₦)</Label>
            <Input
              id="dp-amount"
              type="number"
              min="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <PaymentModeFields value={mode} onChange={setMode} />
          <div className="space-y-2">
            <Label htmlFor="dp-date">Date paid</Label>
            <Input
              id="dp-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dp-note">Note (optional)</Label>
            <Input id="dp-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save payment
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
