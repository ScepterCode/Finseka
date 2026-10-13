import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, Wallet, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  emptyDebtLine,
  OWED_QUERY_KEYS,
  useMemberBroughtForward,
  type BroughtForwardDebt,
  type DebtLine,
} from "@/lib/brought-forward";
import { friendlyError } from "@/lib/errors";
import { naira, shortDate, todayIso } from "@/lib/format";
import { EmptyState } from "@/components/page-parts";
import { MoneyInput } from "@/components/money-input";
import { ReasonDialog } from "@/components/reason-dialog";
import { Badge } from "@/components/ui/badge";
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

// The member profile's "Owed from before" tab, and the editor for typing in debt lines.

/** Labelled amounts, one per row, with a button to add another. */
export function DebtLinesEditor({
  value,
  onChange,
  idPrefix,
}: {
  value: DebtLine[];
  onChange: (lines: DebtLine[]) => void;
  idPrefix: string;
}) {
  const set = (i: number, patch: Partial<DebtLine>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {value.map((l, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            {i === 0 && <Label htmlFor={`${idPrefix}-bf-label-0`}>What for</Label>}
            <Input
              id={`${idPrefix}-bf-label-${i}`}
              value={l.label}
              maxLength={200}
              onChange={(e) => set(i, { label: e.target.value })}
              placeholder="Old dues"
            />
          </div>
          <div className="w-32 space-y-1">
            {i === 0 && <Label htmlFor={`${idPrefix}-bf-amount-0`}>Amount (₦)</Label>}
            <MoneyInput
              id={`${idPrefix}-bf-amount-${i}`}
              min={0}
              value={l.amount}
              onChange={(v) => set(i, { amount: v })}
              placeholder="0"
            />
          </div>
          {value.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove this line"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...value, emptyDebtLine()])}
      >
        <Plus className="size-3.5" /> Another line
      </Button>
    </div>
  );
}

/** The member profile's "Owed from before" tab. */
export function BroughtForwardPanel({
  orgId,
  memberId,
  memberName,
  isAdmin,
  onPay,
}: {
  orgId: string;
  memberId: string;
  memberName: string;
  isAdmin: boolean;
  onPay: (debtId: string) => void;
}) {
  const queryClient = useQueryClient();
  const debts = useMemberBroughtForward(memberId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BroughtForwardDebt | null>(null);
  const [cancelling, setCancelling] = useState<BroughtForwardDebt | null>(null);

  const refresh = () => {
    for (const key of OWED_QUERY_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const cancel = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("cancel_brought_forward_debt", {
        _debt_id: cancelling!.id,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Debt cancelled");
      setCancelling(null);
      refresh();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (debts.isLoading) return <Loader2 className="size-5 animate-spin text-primary" />;
  const all = debts.data ?? [];
  const open = all.filter((d) => !d.cancelled_at);
  const owing = open.reduce((s, d) => s + d.outstanding, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          What {memberName} already owed before you started using FinSeka. It counts in what they
          owe now; money only enters the ledger when they pay it.
          {owing > 0 && (
            <>
              {" "}
              Still owing: <strong className="text-destructive">{naira(owing)}</strong>.
            </>
          )}
        </p>
        {isAdmin && (
          <Button size="sm" className="gap-2" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Bring forward a debt
          </Button>
        )}
      </div>

      {all.length === 0 ? (
        <EmptyState
          title="Nothing brought forward"
          hint={
            isAdmin
              ? `If ${memberName} owed money in your old book, add it here.`
              : "No debts from before FinSeka."
          }
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {all.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
              <span className="min-w-0 flex-1">
                <span
                  className={`block font-medium ${d.cancelled_at ? "line-through opacity-60" : ""}`}
                >
                  {d.label} · {naira(d.amount)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Owed as of {shortDate(d.as_of)}
                  {d.paid > 0 ? ` · paid ${naira(d.paid)}` : ""}
                  {d.note ? ` · ${d.note}` : ""}
                </span>
                {d.cancelled_at && (
                  <span className="block text-xs text-destructive">
                    Cancelled{d.cancel_reason ? `: ${d.cancel_reason}` : ""}
                  </span>
                )}
              </span>
              {!d.cancelled_at &&
                (d.outstanding > 0 ? (
                  <Badge variant="secondary" className="bg-destructive/12 text-destructive">
                    Owing {naira(d.outstanding)}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-success/12 text-success">
                    Paid
                  </Badge>
                ))}
              {isAdmin && !d.cancelled_at && (
                <span className="flex gap-1.5">
                  {d.outstanding > 0 && (
                    <Button size="sm" className="gap-1.5" onClick={() => onPay(d.id)}>
                      <Wallet className="size-3.5" /> Pay
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Edit ${d.label}`}
                    onClick={() => setEditing(d)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive"
                    aria-label={`Cancel ${d.label}`}
                    onClick={() => setCancelling(d)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <DebtDialog
        open={adding || !!editing}
        debt={editing}
        orgId={orgId}
        memberId={memberId}
        memberName={memberName}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false);
            setEditing(null);
          }
        }}
        onSaved={refresh}
      />

      <ReasonDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this debt?"
        description={`${cancelling?.label ?? ""} (${naira(cancelling?.amount ?? 0)}). Use this when it was entered by mistake or settled in the old book. It stays listed as cancelled, and anything already paid towards it stays recorded.`}
        confirmLabel="Yes, cancel it"
        pending={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
      />
    </div>
  );
}

/** Add a debt brought forward, or correct one (its label, amount, date or note). */
function DebtDialog({
  open,
  debt,
  orgId,
  memberId,
  memberName,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  debt: BroughtForwardDebt | null;
  orgId: string;
  memberId: string;
  memberName: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [asOf, setAsOf] = useState(todayIso());
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel(debt?.label ?? "");
    setAmount(debt ? String(debt.amount) : "");
    setAsOf(debt?.as_of ?? todayIso());
    setNote(debt?.note ?? "");
  }, [open, debt]);

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        label: label.trim(),
        amount: Number(amount),
        as_of: asOf,
        note: note.trim() || null,
      };
      const { error } = debt
        ? await supabase.from("brought_forward_debts").update(row).eq("id", debt.id)
        : await supabase
            .from("brought_forward_debts")
            .insert({ ...row, org_id: orgId, member_id: memberId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(debt ? "Debt updated" : "Debt brought forward");
      onOpenChange(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {debt ? `Correct ${debt.label}` : `What did ${memberName} owe before FinSeka?`}
          </DialogTitle>
          <DialogDescription>
            {debt
              ? "Changes are kept in History. The amount cannot go below what has been paid."
              : "Write what it was for, as in your old book. Add one line per thing owed."}
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
            <Label htmlFor="bf-label">What for</Label>
            <Input
              id="bf-label"
              required
              maxLength={200}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Old dues, Building levy…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bf-amount">Amount owed (₦)</Label>
              <MoneyInput id="bf-amount" min={1} required value={amount} onChange={setAmount} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bf-asof">Owed as of</Label>
              <Input
                id="bf-asof"
                type="date"
                required
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bf-note">Note (optional)</Label>
            <Input
              id="bf-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="From the 2025 book, page 12"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={save.isPending || !label.trim() || !(Number(amount) > 0)}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {debt ? "Save changes" : "Bring it forward"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
