import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { confirmProPayment } from "@/lib/billing.functions";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";

type Search = {
  status?: string | undefined;
  tx_ref?: string | undefined;
  transaction_id?: string | undefined;
};

// Flutterwave sends the payer back here. The payment is checked with Flutterwave itself before it
// counts; the webhook records it too, whichever arrives first.
export const Route = createFileRoute("/_authenticated/billing/callback")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    status: typeof s["status"] === "string" ? s["status"] : undefined,
    tx_ref: typeof s["tx_ref"] === "string" ? s["tx_ref"] : undefined,
    transaction_id:
      typeof s["transaction_id"] === "string" || typeof s["transaction_id"] === "number"
        ? String(s["transaction_id"])
        : undefined,
  }),
  component: BillingCallback,
});

function BillingCallback() {
  const search = Route.useSearch();
  const { refreshMe } = useAuth();
  const confirm = useServerFn(confirmProPayment);
  const [state, setState] = useState<"checking" | "paid" | "cancelled" | "pending" | "error">(
    search.status === "cancelled" ? "cancelled" : "checking",
  );
  const [message, setMessage] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (state !== "checking" || started.current) return;
    started.current = true;
    if (!search.transaction_id || !search.tx_ref) {
      setState("pending");
      return;
    }
    confirm({ data: { transactionId: search.transaction_id, txRef: search.tx_ref } })
      .then((r) => {
        setState(r.outcome === "ignored" ? "pending" : "paid");
        refreshMe();
      })
      .catch((e: unknown) => {
        setMessage(friendlyError(e));
        setState("error");
      });
  }, [state, search, confirm, refreshMe]);

  const text = {
    checking: "Checking your payment with Flutterwave…",
    paid: "Payment received. FinSeka Pro is on — thank you!",
    cancelled: "The payment was cancelled. Nothing was charged.",
    pending:
      "We couldn’t confirm the payment yet. If money left your account, Pro turns on within a few minutes once Flutterwave tells us.",
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
