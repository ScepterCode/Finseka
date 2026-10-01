import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Billing } from "@/hooks/useAuth";
import { cancelAutoRenew, getBillingOptions, startProCheckout } from "@/lib/billing.functions";
import { billingSummary, daysUntil } from "@/lib/billing";
import { friendlyError } from "@/lib/errors";
import { naira, shortDate } from "@/lib/format";
import { ConfirmButton } from "@/components/confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Shown at the top of every page when the trial is nearly over, a payment is overdue, or the plan has ended.
export function BillingBanner() {
  const { billing, support, isAdmin } = useAuth();
  if (!billing || support) return null;
  const trialLeft = daysUntil(billing.trial_ends_at);
  const show =
    billing.status === "read_only" ||
    billing.status === "grace" ||
    (billing.status === "trial" && trialLeft <= 7);
  if (!show) return null;

  const ended = billing.status === "read_only";
  const text = ended
    ? "Your FinSeka plan has ended. You can still see all your records, but you can’t record, download or print anything until you upgrade to Pro."
    : billing.status === "grace"
      ? `Your Pro payment is overdue. Pay by ${shortDate(billing.grace_ends_at)} to keep recording.`
      : `${trialLeft} day${trialLeft === 1 ? "" : "s"} left in your free trial. Upgrade to Pro (${naira(billing.price)} a month) to keep recording after ${shortDate(billing.trial_ends_at)}.`;

  return (
    <>
      {ended && (
        <style>{`@media print {
          body * { visibility: hidden !important; }
          body::before { content: "Printing is available on FinSeka Pro."; visibility: visible; display: block; padding: 2rem; font: 16px sans-serif; }
        }`}</style>
      )}
      <div
        className={`print-hide flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm ${
          ended
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        }`}
      >
        <CreditCard className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{text}</span>
        {/* While the plan has ended isAdmin is false, so offer the button to everyone; Billing explains who can pay. */}
        {(isAdmin || ended) && (
          <Button asChild size="sm" variant="outline" className="bg-transparent">
            <Link to="/settings" hash="billing">
              {ended ? "Upgrade to Pro" : "See billing"}
            </Link>
          </Button>
        )}
      </div>
    </>
  );
}

// Settings → Billing: the plan, how to pay, and past payments.
export function BillingSection() {
  const { billing, refreshMe } = useAuth();
  const getOptions = useServerFn(getBillingOptions);
  const checkout = useServerFn(startProCheckout);
  const cancel = useServerFn(cancelAutoRenew);

  const canManage = useQuery({
    queryKey: ["billing", "can-manage"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_manage_billing");
      if (error) throw error;
      return data === true;
    },
  });
  const options = useQuery({
    queryKey: ["billing", "options"],
    enabled: canManage.data === true,
    queryFn: () => getOptions(),
  });
  const payments = useQuery({
    queryKey: ["billing", "payments"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("org_billing_payments");
      if (error) throw error;
      return data ?? [];
    },
  });

  const pay = useMutation({
    mutationFn: async () => checkout(),
    onSuccess: ({ link }) => {
      window.location.href = link;
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });
  const stopRenewal = useMutation({
    mutationFn: async () => cancel(),
    onSuccess: () => {
      toast.success("Auto-renewal is off. You keep Pro until the end of the time you paid for.");
      refreshMe();
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (!billing) return null;
  const needsPayment =
    billing.status !== "free" && !(billing.status === "active" && billing.auto_renew);

  return (
    <section
      id="billing"
      className="scroll-mt-20 rounded-3xl border border-border bg-card p-6 shadow-soft"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-semibold">Billing</h2>
        <Badge
          variant={
            billing.status === "read_only"
              ? "destructive"
              : billing.status === "active" || billing.status === "free"
                ? "default"
                : "secondary"
          }
        >
          {
            {
              trial: "Free trial",
              active: "Pro",
              grace: "Payment overdue",
              read_only: "Plan ended",
              free: "Free plan",
            }[billing.status]
          }
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{billingSummary(billing)}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        FinSeka Pro is {naira(billing.price)} a month for your whole organization: every member,
        every admin.
      </p>

      {canManage.data === false && needsPayment && (
        <p className="mt-4 text-sm">Ask an admin of your organization to upgrade to Pro.</p>
      )}

      {canManage.data && needsPayment && (
        <div className="mt-5 space-y-4">
          {options.isLoading ? (
            <Loader2 className="size-5 animate-spin text-primary" />
          ) : options.data?.online ? (
            <div className="space-y-2">
              <Button size="lg" disabled={pay.isPending} onClick={() => pay.mutate()}>
                {pay.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CreditCard className="size-4" />
                )}
                Pay {naira(billing.price)} a month
              </Button>
              <p className="text-xs text-muted-foreground">
                You pay on Flutterwave’s secure page (card, bank transfer or USSD). It renews every
                month until you turn it off.
                {billing.status === "trial" &&
                  " Paying now doesn’t shorten your trial: Pro starts when the trial ends."}
              </p>
            </div>
          ) : null}
          {(!options.data?.online || options.data?.bankDetails) && !options.isLoading && (
            <div className="rounded-2xl border border-border bg-secondary/50 p-4 text-sm">
              <p className="font-medium">
                {options.data?.online ? "Or pay by bank transfer" : "Pay by bank transfer"}
              </p>
              {options.data?.bankDetails ? (
                <p className="mt-1 whitespace-pre-line text-muted-foreground">
                  {options.data.bankDetails}
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">Contact FinSeka for payment details.</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Use your organization’s name as the reference. FinSeka turns on Pro once the payment
                arrives.
              </p>
            </div>
          )}
        </div>
      )}

      {canManage.data && billing.status === "active" && billing.auto_renew && (
        <div className="mt-5">
          <ConfirmButton
            variant="outline"
            title="Turn off auto-renewal?"
            description={`You keep Pro until ${shortDate(billing.paid_until)}. After that your records become read-only until you pay again.`}
            confirmLabel="Turn it off"
            onConfirm={() => stopRenewal.mutate()}
          >
            Turn off auto-renewal
          </ConfirmButton>
        </div>
      )}

      {(payments.data ?? []).length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Payments</h3>
          <ul className="mt-2 divide-y divide-border text-sm">
            {(payments.data ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {naira(p.amount)} · {p.months} month{p.months === 1 ? "" : "s"}
                  <span className="text-muted-foreground">
                    {" "}
                    · {p.provider === "flutterwave" ? "Flutterwave" : "Recorded by FinSeka"}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {shortDate(p.paid_at)} · covers to {shortDate(p.covers_until)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
