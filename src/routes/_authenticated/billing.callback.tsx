import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { confirmBachsPayment, confirmProPayment } from "@/lib/billing.functions";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";

type Search = {
  status?: string | undefined;
  tx_ref?: string | undefined;
  transaction_id?: string | undefined;
  checkout_id?: string | undefined;
};

// Bachs (with ?checkout_id=) or Flutterwave sends the payer back here. The payment is checked with
// the provider itself before it counts; the webhook records it too, whichever arrives first.
export const Route = createFileRoute("/_authenticated/billing/callback")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    status: typeof s["status"] === "string" ? s["status"] : undefined,
    tx_ref: typeof s["tx_ref"] === "string" ? s["tx_ref"] : undefined,
    transaction_id:
      typeof s["transaction_id"] === "string" || typeof s["transaction_id"] === "number"
        ? String(s["transaction_id"])
        : undefined,
    checkout_id: typeof s["checkout_id"] === "string" ? s["checkout_id"] : undefined,
  }),
  component: BillingCallback,
});

function BillingCallback() {
  const search = Route.useSearch();
  const { refreshMe } = useAuth();
  const confirm = useServerFn(confirmProPayment);
  const confirmBachs = useServerFn(confirmBachsPayment);
  const provider = search.checkout_id ? "Bachs" : "Flutterwave";
  const [state, setState] = useState<"checking" | "paid" | "cancelled" | "pending" | "error">(
    search.status === "cancelled" ? "cancelled" : "checking",
  );
  const [message, setMessage] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (state !== "checking" || started.current) return;
    started.current = true;
    const check = search.checkout_id
      ? confirmBachs({ data: { checkoutId: search.checkout_id } })
      : search.transaction_id && search.tx_ref
        ? confirm({ data: { transactionId: search.transaction_id, txRef: search.tx_ref } })
        : null;
    if (!check) {
      setState("pending");
      return;
    }
    check
      .then((r) => {
        setState(r.outcome === "ignored" ? "pending" : "paid");
        refreshMe();
      })
      .catch((e: unknown) => {
        setMessage(friendlyError(e));
        setState("error");
      });
  }, [state, search, confirm, confirmBachs, refreshMe]);

  const text = {
    checking: `Checking your payment with ${provider}…`,
    paid: "Payment received. FinSeka Pro is on — thank you!",
    cancelled: "The payment was cancelled. Nothing was charged.",
    pending: `We couldn’t confirm the payment yet. If money left your account, Pro turns on within a few minutes once ${provider} tells us.`,
    error: `We couldn’t check the payment: ${message}`,
  }[state];

  return (
    <div className="mx-auto max-w-md space-y-6 py-10 text-center">
      {state === "checking" && <Loader2 className="mx-auto size-6 animate-spin text-primary" />}
      <p className="text-base">{text}</p>
      {state !== "checking" && (
        <Button asChild size="lg">
          <Link to="/settings" hash="billing">
            Back to billing
          </Link>
        </Button>
      )}
    </div>
  );
}
