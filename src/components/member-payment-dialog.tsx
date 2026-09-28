import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wallet } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";

type Part = { kind: string; name: string; period: string | null; amount: number };

/**
 * Record one payment on a member's profile. The database applies it to their oldest
 * debts first (each due period in date order, then compulsory contributions).
 */
export function MemberPaymentDialog({
  memberId,
  memberName,
  owing,
}: {
  memberId: string;
  memberName: string;
  owing: number;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState<PaymentMode>(defaultPaymentMode);
  const [note, setNote] = useState("");
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("pay_member_debts", {
        _member_id: memberId,
        _amount: Number(amount),
        _paid_at: date,
        _channel: mode.channel,
        _client_ref: clientRef,
        ...(mode.reference.trim() ? { _reference: mode.reference.trim() } : {}),
        ...(note.trim() ? { _note: note.trim() } : {}),
      });
      if (error) throw error;
      return data as unknown as { already_saved: boolean; parts: Part[] };
    },
    onSuccess: (r) => {
      const parts = r.parts.map(
        (p) => `${p.name}${p.period ? ` ${p.period}` : ""} ${naira(p.amount)}`,
      );
      toast.success(
        r.already_saved
          ? "That payment was already saved"
          : `Payment recorded: ${parts.join(", ")}`,
      );
      setOpen(false);
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setAmount(String(owing));
          setDate(todayIso());
          setMode(defaultPaymentMode);
          setNote("");
          setClientRef(crypto.randomUUID());
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Wallet className="size-3.5" /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a payment from {memberName}</DialogTitle>
          <DialogDescription>
            They owe {naira(owing)}. The payment goes to their oldest debts first; each part shows
            in the ledger as usual.
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
            <Label htmlFor="mp-amount">How much did they pay? (₦)</Label>
            <Input
              id="mp-amount"
              type="number"
              min="1"
              max={owing}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
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
          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save payment
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
