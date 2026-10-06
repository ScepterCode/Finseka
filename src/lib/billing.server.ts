// Connects the payment rules (lib/flutterwave.ts, lib/bachs.ts) to FinSeka's database and the
// providers' APIs.
// Server code only: it uses the service role key.

import type { BachsDeps } from "@/lib/bachs";
import { bachsConfig, getBachsCheckout } from "@/lib/bachs.server";
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

/** The most months of Pro an organization can pay for in one go. */
export const MAX_MONTHS = 12;

export async function bachsDeps(): Promise<BachsDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    webhookSecret: bachsConfig().webhookSecret,
    price: PRO_PRICE,
    fetchCheckout: getBachsCheckout,
    checkoutFor: async (reference) => {
      const { data, error } = await supabaseAdmin.rpc("billing_checkout", {
        _reference: reference,
      });
      if (error) throw new Error(error.message);
      const row = data as { org_id?: string; months?: number } | null;
      return row?.org_id ? { orgId: row.org_id, months: Number(row.months ?? 1) } : null;
    },
    recordPayment: async (p) => {
      const { data, error } = await supabaseAdmin.rpc("record_subscription_payment", {
        _org_id: p.orgId,
        _provider: "bachs",
        _provider_ref: p.providerRef,
        _amount: p.amount,
        _currency: p.currency,
        _months: p.months,
        _paid_at: p.paidAt ?? new Date().toISOString(),
        _raw: p.raw as never,
      });
      if (error) throw new Error(error.message);
      return { duplicate: (data as { duplicate?: boolean } | null)?.duplicate === true };
    },
  };
}
