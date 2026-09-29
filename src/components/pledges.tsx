import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchAll } from "@/lib/fetch-all";
import { friendlyError } from "@/lib/errors";
import { naira, shortDate, todayIso } from "@/lib/format";
import { defaultPaymentMode, paymentModeText, type PaymentMode } from "@/lib/methods";
import { matchesPerson } from "@/lib/search";
import { pledgeTotals, useInvalidatePledges, type Pledge, type PledgeTarget } from "@/lib/pledges";
import { PaymentModeFields } from "@/components/method-select";
import { ReasonDialog } from "@/components/reason-dialog";
import { SearchBox } from "@/components/search-box";
import { StatCard } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

// Pledges are promises of money. They are never a debt: they do not count in what a
// member owes. Money received against a pledge is a "redemption", recorded with its
// mode and date, and it lands in the ledger.

const statusText: Record<Pledge["status"], string> = {
  open: "Not redeemed",
  part: "Part redeemed",
  redeemed: "Redeemed",
  cancelled: "Cancelled",
};

export function PledgeStats({ pledges, target }: { pledges: Pledge[]; target?: number | null }) {
  const t = pledgeTotals(pledges);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Pledged"
        value={naira(t.pledged)}
        tone="accent"
        hint={`${t.count} ${t.count === 1 ? "pledge" : "pledges"}${target ? ` · target ${naira(target)}` : ""}`}
      />
      <StatCard label="Redeemed" value={naira(t.redeemed)} tone="good" hint="Money received" />
      <StatCard
        label="Still to come"
        value={naira(t.outstanding)}
        hint="Promised, not yet received. Not counted as a debt."
      />
    </div>
  );
}

export function PledgeStatus({ status }: { status: Pledge["status"] }) {
  const tone =
    status === "redeemed"
      ? "bg-success/12 text-success"
      : status === "part"
        ? "bg-accent/15 text-accent"
        : status === "cancelled"
          ? "bg-secondary text-muted-foreground line-through"
          : "bg-primary-soft text-primary";
  return (
    <Badge variant="secondary" className={tone}>
      {statusText[status]}
    </Badge>
  );
}

/** Where a pledge's "for" links to: its drive or its contribution. */
function ForLink({ p }: { p: Pledge }) {
  if (p.drive_id)
    return (
      <Link to="/pledges/$driveId" params={{ driveId: p.drive_id }} className="link">
        {p.for_name}
      </Link>
    );
  if (p.contribution_id)
    return (
      <Link
        to="/contributions/$contributionId"
        params={{ contributionId: p.contribution_id }}
        className="link"
      >
        {p.for_name}
      </Link>
    );
  return <>{p.for_name ?? "—"}</>;
}

/** The pledges table, with Redeem and Details on each line. */
export function PledgeTable({
  pledges,
  showFor = false,
  emptyHint = "No pledges yet.",
}: {
  pledges: Pledge[];
  showFor?: boolean;
  emptyHint?: string;
}) {
  const { isAdmin } = useAuth();
  const [redeeming, setRedeeming] = useState<Pledge | null>(null);
  const [viewing, setViewing] = useState<Pledge | null>(null);

  if (pledges.length === 0) {
    return (
      <p className="rounded-3xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
        {emptyHint}
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Who</th>
              {showFor && <th className="px-4 py-3">For</th>}
              <th className="px-4 py-3">Pledged on</th>
              <th className="px-4 py-3 text-right">Pledged</th>
              <th className="px-4 py-3 text-right">Redeemed</th>
              <th className="px-4 py-3 text-right">Still to come</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pledges.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-4 py-3">
                  <span className="block font-medium">
                    {p.member_id ? (
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: p.member_id }}
                        className="link"
                      >
                        {p.pledger_name}
                      </Link>
                    ) : (
                      p.pledger_name
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {p.member_id ? "Member" : "Not a member"}
                    {p.pledger_phone ? ` · ${p.pledger_phone}` : ""}
                  </span>
                </td>
                {showFor && (
                  <td className="px-4 py-3">
                    <ForLink p={p} />
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-3">
                  {shortDate(p.pledged_on)}
                  {p.promised_by && (
                    <span className="block text-xs text-muted-foreground">
                      promised by {shortDate(p.promised_by)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                  {naira(Number(p.amount))}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-success">
                  {Number(p.redeemed) ? naira(Number(p.redeemed)) : "—"}
                  {p.last_paid_at && (
                    <span className="block text-xs text-muted-foreground">
                      last {shortDate(p.last_paid_at)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {Number(p.outstanding) ? naira(Number(p.outstanding)) : "—"}
                </td>
                <td className="px-4 py-3">
                  <PledgeStatus status={p.status} />
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    {isAdmin && Number(p.outstanding) > 0 && (
                      <Button size="sm" onClick={() => setRedeeming(p)}>
                        Redeem
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setViewing(p)}>
                      Details
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RedeemPledgeDialog pledge={redeeming} onClose={() => setRedeeming(null)} />
      <PledgeDetailsDialog
        pledge={viewing}
        onClose={() => setViewing(null)}
        onRedeem={(p) => {
          setViewing(null);
          setRedeeming(p);
        }}
      />
    </>
  );
}

/** Record money received against a pledge: all of what is left, or part of it. */
export function RedeemPledgeDialog({
  pledge,
  onClose,
}: {
  pledge: Pledge | null;
  onClose: () => void;
}) {
  const { orgId } = useAuth();
  const invalidate = useInvalidatePledges();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState<PaymentMode>(defaultPaymentMode);
  const [note, setNote] = useState("");
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!pledge) return;
    setAmount(String(Number(pledge.outstanding)));
    setDate(todayIso());
    setMode(defaultPaymentMode);
    setNote("");
    setClientRef(crypto.randomUUID());
  }, [pledge]);

  const outstanding = Number(pledge?.outstanding ?? 0);
  const value = Number(amount);
  const tooMuch = value > outstanding;
  const left = Math.max(outstanding - value, 0);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pledge_payments").upsert(
        {
          org_id: orgId!,
          pledge_id: pledge!.id,
          amount: value,
          paid_at: date,
          channel: mode.channel,
          reference: mode.reference.trim() || null,
          note: note.trim() || null,
          client_ref: clientRef,
        },
        { onConflict: "client_ref", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        left > 0
          ? `${naira(value)} received from ${pledge?.pledger_name}. ${naira(left)} still to come.`
          : `${pledge?.pledger_name}'s pledge is fully redeemed`,
      );
      onClose();
      invalidate();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog open={!!pledge} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Redeem a pledge</DialogTitle>
          <DialogDescription>
            {pledge?.pledger_name} pledged {naira(Number(pledge?.amount ?? 0))} for{" "}
            {pledge?.for_name}. {naira(outstanding)} is still to come.
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
            <Label htmlFor="rp-amount">How much was received? (₦)</Label>
            <Input
              id="rp-amount"
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
                  ? `That is more than the ${naira(outstanding)} left on this pledge. Record anything extra as a new pledge or gift.`
                  : left === 0
                    ? "This redeems the pledge in full."
                    : `Part redemption: ${naira(left)} will still be to come.`}
              </p>
            )}
          </div>
          <PaymentModeFields value={mode} onChange={setMode} />
          <div className="space-y-2">
            <Label htmlFor="rp-date">Date received</Label>
            <Input
              id="rp-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rp-note">Note (optional)</Label>
            <Input id="rp-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={save.isPending || tooMuch || !(value > 0)}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Who pledged, what came in so far, and the admin actions (cancel a payment or the pledge). */
function PledgeDetailsDialog({
  pledge,
  onClose,
  onRedeem,
}: {
  pledge: Pledge | null;
  onClose: () => void;
  onRedeem: (p: Pledge) => void;
}) {
  const { isAdmin } = useAuth();
  const invalidate = useInvalidatePledges();
  const [cancellingPayment, setCancellingPayment] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [cancellingPledge, setCancellingPledge] = useState(false);

  const payments = useQuery({
    queryKey: ["pledges", "payments", pledge?.id],
    enabled: !!pledge,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pledge_payments")
        .select("id, amount, paid_at, channel, method, reference, note, voided_at, void_reason")
        .eq("pledge_id", pledge!.id)
        .order("paid_at", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const voidPayment = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("void_payment", {
        _kind: "pledge",
        _payment_id: cancellingPayment!.id,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment cancelled and reversed in the ledger");
      setCancellingPayment(null);
      onClose();
      invalidate();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const cancelPledge = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("cancel_pledge", {
        _pledge_id: pledge!.id,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pledge cancelled");
      setCancellingPledge(false);
      onClose();
      invalidate();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const p = pledge;
  return (
    <>
      <Dialog
        open={!!p && !cancellingPayment && !cancellingPledge}
        onOpenChange={(o) => !o && onClose()}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {p && (
            <>
              <DialogHeader>
                <DialogTitle>{p.pledger_name}'s pledge</DialogTitle>
                <DialogDescription>
                  {naira(Number(p.amount))} for {p.for_name} · pledged {shortDate(p.pledged_on)}
                  {p.promised_by ? ` · promised by ${shortDate(p.promised_by)}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <PledgeStatus status={p.status} />
                  <span className="text-muted-foreground">
                    Redeemed {naira(Number(p.redeemed))} · still to come{" "}
                    {naira(Number(p.outstanding))}
                  </span>
                </div>
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
                  <dt className="text-muted-foreground">Member?</dt>
                  <dd>{p.member_id ? "Yes" : "No"}</dd>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>{p.pledger_phone || "—"}</dd>
                  <dt className="text-muted-foreground">Address</dt>
                  <dd className="break-words">{p.pledger_address || "—"}</dd>
                  {p.note && (
                    <>
                      <dt className="text-muted-foreground">Note</dt>
                      <dd className="break-words">{p.note}</dd>
                    </>
                  )}
                  {p.cancel_reason && (
                    <>
                      <dt className="text-muted-foreground">Cancelled</dt>
                      <dd className="break-words text-destructive">{p.cancel_reason}</dd>
                    </>
                  )}
                </dl>

                <div>
                  <p className="mb-2 font-medium">Money received</p>
                  {payments.isLoading ? (
                    <Loader2 className="size-4 animate-spin text-primary" />
                  ) : (payments.data ?? []).length === 0 ? (
                    <p className="text-muted-foreground">Nothing received yet.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-2xl border border-border">
                      {(payments.data ?? []).map((pay) => (
                        <li
                          key={pay.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                        >
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block ${pay.voided_at ? "line-through opacity-60" : ""}`}
                            >
                              {shortDate(pay.paid_at)} ·{" "}
                              {paymentModeText(pay.channel, pay.reference, pay.method)}
                            </span>
                            {pay.voided_at && (
                              <span className="block text-xs text-destructive">
                                Cancelled{pay.void_reason ? `: ${pay.void_reason}` : ""}
                              </span>
                            )}
                          </span>
                          <span
                            className={`font-semibold ${pay.voided_at ? "text-muted-foreground line-through" : "text-success"}`}
                          >
                            {naira(Number(pay.amount))}
                          </span>
                          {isAdmin && !pay.voided_at && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-destructive/40 text-destructive"
                              onClick={() =>
                                setCancellingPayment({
                                  id: pay.id,
                                  label: `${naira(Number(pay.amount))} received ${shortDate(pay.paid_at)}`,
                                })
                              }
                            >
                              Cancel
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {isAdmin && p.status !== "cancelled" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {Number(p.outstanding) > 0 && (
                      <Button onClick={() => onRedeem(p)}>Redeem</Button>
                    )}
                    {p.status !== "redeemed" && (
                      <Button
                        variant="outline"
                        className="border-destructive/40 text-destructive"
                        onClick={() => setCancellingPledge(true)}
                      >
                        Cancel the pledge
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={!!cancellingPayment}
        onOpenChange={(o) => !o && setCancellingPayment(null)}
        title="Cancel this payment?"
        description={`${cancellingPayment?.label ?? ""}. It stays listed, marked as cancelled, and the ledger gets a reversing line.`}
        confirmLabel="Yes, cancel it"
        pending={voidPayment.isPending}
        onConfirm={(reason) => voidPayment.mutate(reason)}
      />
      <ReasonDialog
        open={cancellingPledge}
        onOpenChange={setCancellingPledge}
        title="Cancel this pledge?"
        description={`${p?.pledger_name ?? ""} will no longer be expected to pay the ${naira(Number(p?.outstanding ?? 0))} still to come. Money already received stays recorded.`}
        confirmLabel="Yes, cancel the pledge"
        pending={cancelPledge.isPending}
        onConfirm={(reason) => cancelPledge.mutate(reason)}
      />
    </>
  );
}

/**
 * Record a pledge (or a gift paid on the spot) from a member or from anyone else.
 * With `target` the pledge is for that drive or contribution; otherwise the admin picks.
 */
export function AddPledgeDialog({
  target,
  size = "lg",
}: {
  target?: PledgeTarget;
  size?: "sm" | "lg";
}) {
  const { orgId } = useAuth();
  const invalidate = useInvalidatePledges();
  const [open, setOpen] = useState(false);
  const [forKey, setForKey] = useState("");
  const [who, setWho] = useState<"member" | "other">("member");
  const [memberId, setMemberId] = useState("");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [pledgedOn, setPledgedOn] = useState(todayIso());
  const [promisedBy, setPromisedBy] = useState("");
  const [note, setNote] = useState("");
  const [paidNow, setPaidNow] = useState(false);
  const [mode, setMode] = useState<PaymentMode>(defaultPaymentMode);

  const members = useQuery({
    queryKey: ["members-simple-phone", orgId],
    enabled: open && !!orgId,
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

  // What a pledge can be for: open drives and open contributions that take pledges.
  const options = useQuery({
    queryKey: ["pledge-drives", "options", orgId],
    enabled: open && !target && !!orgId,
    queryFn: async () => {
      const [drives, contributions] = await Promise.all([
        supabase.from("pledge_drives").select("id, name").eq("closed", false).order("name"),
        supabase
          .from("contributions")
          .select("id, name")
          .eq("accepts_pledges", true)
          .eq("closed", false)
          .order("name"),
      ]);
      if (drives.error) throw drives.error;
      if (contributions.error) throw contributions.error;
      return [
        ...drives.data.map((d) => ({ key: `drive:${d.id}`, label: `${d.name} (pledge drive)` })),
        ...contributions.data.map((c) => ({
          key: `contribution:${c.id}`,
          label: `${c.name} (contribution)`,
        })),
      ];
    },
  });

  const reset = () => {
    setForKey(target ? `${target.kind}:${target.id}` : "");
    setWho("member");
    setMemberId("");
    setSearch("");
    setName("");
    setPhone("");
    setAddress("");
    setAmount("");
    setPledgedOn(todayIso());
    setPromisedBy("");
    setNote("");
    setPaidNow(false);
    setMode(defaultPaymentMode);
  };

  const matches = (members.data ?? [])
    .filter((m) => matchesPerson(search, m.name, m.phone))
    .slice(0, 8);
  const picked = (members.data ?? []).find((m) => m.id === memberId);

  const save = useMutation({
    mutationFn: async () => {
      const [kind, id] = forKey.split(":");
      if (!kind || !id) throw new Error("Pick what the pledge is for.");
      if (who === "member" && !memberId) throw new Error("Pick the member who is pledging.");
      const { data, error } = await supabase
        .from("pledges")
        .insert({
          org_id: orgId!,
          ...(kind === "drive" ? { drive_id: id } : { contribution_id: id }),
          ...(who === "member"
            ? { member_id: memberId, pledger_name: "" }
            : {
                pledger_name: name.trim(),
                pledger_phone: phone.trim() || null,
                pledger_address: address.trim() || null,
              }),
          amount: Number(amount),
          pledged_on: pledgedOn,
          promised_by: promisedBy || null,
          note: note.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (paidNow) {
        const { error: payError } = await supabase.from("pledge_payments").insert({
          org_id: orgId!,
          pledge_id: data.id,
          amount: Number(amount),
          paid_at: pledgedOn,
          channel: mode.channel,
          reference: mode.reference.trim() || null,
        });
        if (payError) throw payError;
      }
    },
    onSuccess: () => {
      toast.success(paidNow ? "Gift recorded and added to the ledger" : "Pledge recorded");
      setOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <Button size={size} className="gap-2" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add pledge
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a pledge or gift</DialogTitle>
          <DialogDescription>
            {target ? `For ${target.name}. ` : ""}A pledge is a promise; it is never counted as a
            debt. Tick “Paid now” for a gift received on the spot.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {!target && (
            <div className="space-y-2">
              <Label>What is it for?</Label>
              <Select value={forKey} onValueChange={setForKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a pledge drive or contribution" />
                </SelectTrigger>
                <SelectContent>
                  {(options.data ?? []).map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {options.data && options.data.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nothing takes pledges yet. Start a pledge drive, or turn on pledges for a
                  contribution.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Who is pledging?</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={who === "member" ? "default" : "outline"}
                onClick={() => setWho("member")}
              >
                A member
              </Button>
              <Button
                type="button"
                variant={who === "other" ? "default" : "outline"}
                onClick={() => setWho("other")}
              >
                Someone else
              </Button>
            </div>
          </div>

          {who === "member" ? (
            <div className="space-y-2">
              {picked ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary-soft px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{picked.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {picked.phone || "No phone saved"}
                    </span>
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setMemberId("")}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <SearchBox value={search} onChange={setSearch} />
                  <ul className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-border p-2">
                    {members.isLoading && (
                      <li className="px-2 py-2">
                        <Loader2 className="size-4 animate-spin text-primary" />
                      </li>
                    )}
                    {matches.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => setMemberId(m.id)}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-secondary"
                        >
                          <span className="font-medium">{m.name}</span>
                          <span className="text-xs text-primary underline underline-offset-2">
                            Pick
                          </span>
                        </button>
                      </li>
                    ))}
                    {members.data && matches.length === 0 && (
                      <li className="px-3 py-2 text-sm text-muted-foreground">
                        No member matches. Choose “Someone else” for people outside the group.
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="pl-name">Name</Label>
                <Input
                  id="pl-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pl-phone">Phone (optional)</Label>
                  <Input id="pl-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pl-address">Address (optional)</Label>
                  <Input
                    id="pl-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pl-amount">Amount (₦)</Label>
              <Input
                id="pl-amount"
                type="number"
                min="1"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pl-date">{paidNow ? "Date received" : "Date pledged"}</Label>
              <Input
                id="pl-date"
                type="date"
                required
                value={pledgedOn}
                onChange={(e) => setPledgedOn(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-border px-4 py-3 text-sm">
            <Checkbox checked={paidNow} onCheckedChange={(v) => setPaidNow(v === true)} />
            <span>
              <span className="block font-medium">Paid now (a gift)</span>
              <span className="block text-xs text-muted-foreground">
                The money was handed over already. It is recorded as redeemed and added to the
                ledger.
              </span>
            </span>
          </label>

          {paidNow ? (
            <PaymentModeFields value={mode} onChange={setMode} />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="pl-promised">Promised to pay by (optional)</Label>
              <Input
                id="pl-promised"
                type="date"
                value={promisedBy}
                onChange={(e) => setPromisedBy(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pl-note">Note (optional)</Label>
            <Input id="pl-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="w-full gap-2" disabled={save.isPending}>
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {paidNow ? "Save gift" : "Save pledge"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
