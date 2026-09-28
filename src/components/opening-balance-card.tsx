import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/errors";
import { naira, todayIso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * One-time step for admins: how much cash and bank money the organization already had
 * when it started using FinSeka. Hidden once it is set (or skipped).
 */
export function OpeningBalanceCard() {
  const { isAdmin, org, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const [cash, setCash] = useState("");
  const [bank, setBank] = useState("");
  const [asOf, setAsOf] = useState(todayIso());

  const save = useMutation({
    mutationFn: async (v: { cash: number; bank: number }) => {
      const { error } = await supabase.rpc("set_opening_balance", {
        _cash: v.cash,
        _bank: v.bank,
        _as_of: asOf,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(
        v.cash + v.bank > 0
          ? `Opening balance of ${naira(v.cash + v.bank)} saved`
          : "Starting from ₦0",
      );
      refreshMe();
      for (const key of ["dashboard", "ledger", "ledger-balance", "reports"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (!isAdmin || !org || org.opening_balance_set) return null;

  return (
    <section className="rounded-3xl border border-primary/30 bg-primary-soft/40 p-6 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Wallet className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">How much money do you have today?</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Enter what is already in the purse, so your balance starts from the right number. You
            only do this once. Payments you record from now on add to it.
          </p>
        </div>
      </div>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ cash: Number(cash || 0), bank: Number(bank || 0) });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="ob-cash">Cash in hand (₦)</Label>
          <Input
            id="ob-cash"
            type="number"
            min="0"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ob-bank">Money in the bank (₦)</Label>
          <Input
            id="ob-bank"
            type="number"
            min="0"
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ob-date">As of</Label>
          <Input id="ob-date" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save opening balance
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => save.mutate({ cash: 0, bank: 0 })}
          >
            We are starting from ₦0
          </Button>
        </div>
      </form>
    </section>
  );
}
