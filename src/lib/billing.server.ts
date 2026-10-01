// Connects the Flutterwave rules (lib/flutterwave.ts) to FinSeka's database and Flutterwave's API.
// Server code only: it uses the service role key.

import type { FlutterwaveDeps } from "@/lib/flutterwave";
import { flutterwaveConfig, verifyTransaction } from "@/lib/flutterwave.server";

export const PRO_PRICE = 5000;

export async function flutterwaveDeps(): Promise<FlutterwaveDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rpcOrNull = async (
    name: "org_for_checkout" | "org_for_payer_email",
    args: Record<string, string>,
  ) => {
    const { data, error } = await supabaseAdmin.rpc(name, args as never);
    if (error) throw new Error(error.message);
    return (data as string | null) ?? null;
  };
  return {
    webhookHash: flutterwaveConfig().webhookHash,
    price: PRO_PRICE,
    verifyTransaction,
    orgForCheckout: (txRef) => rpcOrNull("org_for_checkout", { _tx_ref: txRef }),
    orgForPayerEmail: (email) => rpcOrNull("org_for_payer_email", { _email: email }),
    recordPayment: async (p) => {
      const { data, error } = await supabaseAdmin.rpc("record_subscription_payment", {
        _org_id: p.orgId,
        _provider: "flutterwave",
        _provider_ref: p.providerRef,
        _amount: p.amount,
        _currency: p.currency,
        _months: 1,
        _paid_at: p.paidAt ?? new Date().toISOString(),
        _raw: p.raw as never,
        ...(p.email ? { _provider_email: p.email } : {}),
      });
      if (error) throw new Error(error.message);
      return { duplicate: (data as { duplicate?: boolean } | null)?.duplicate === true };
    },
    markAutoRenewCancelled: async (orgId) => {
      const { error } = await supabaseAdmin.rpc("mark_auto_renew_cancelled", { _org_id: orgId });
      if (error) throw new Error(error.message);
    },
  };
}
