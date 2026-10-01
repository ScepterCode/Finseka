import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type UserClient = {
  rpc: (n: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (t: "org_billing") => {
    select: (c: string) => {
      maybeSingle: () => Promise<{ data: { provider_email: string | null } | null }>;
    };
  };
};

type AppContext = { org: { id: string; name: string } | null };

async function requireBillingManager(supabase: UserClient) {
  const { data: allowed, error } = await supabase.rpc("can_manage_billing");
  if (error) throw new Error(error.message);
  if (allowed !== true) throw new Error("Only an admin of your organization can manage its plan.");
  const { data: context } = await supabase.rpc("app_context");
  const org = (context as AppContext | null)?.org;
  if (!org) throw new Error("Organization not found.");
  return org;
}

function siteUrl() {
  const configured = process.env["APP_URL"]?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(getRequest().url).origin;
}

/** How the organization can pay: online (Flutterwave) when it is set up, else bank transfer. */
export const getBillingOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { flutterwaveConfig } = await import("@/lib/flutterwave.server");
    const { PRO_PRICE } = await import("@/lib/billing.server");
    return {
      online: flutterwaveConfig().online,
      price: PRO_PRICE,
      bankDetails: process.env["BILLING_BANK_DETAILS"]?.trim() || null,
    };
  });

/** Starts a Flutterwave checkout for Pro and returns the payment page to go to. */
export const startProCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const org = await requireBillingManager(context.supabase as unknown as UserClient);
    const email = typeof context.claims["email"] === "string" ? context.claims["email"] : "";
    if (!email) throw new Error("Your login has no email address to send the receipt to.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createProCheckout } = await import("@/lib/flutterwave.server");
    const { PRO_PRICE } = await import("@/lib/billing.server");

    const txRef = `finseka-${org.id.slice(0, 8)}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const { error } = await supabaseAdmin.rpc("create_billing_checkout", {
      _tx_ref: txRef,
      _org_id: org.id,
      _by: context.userId,
      _email: email,
    });
    if (error) throw new Error(error.message);

    const meta = (context.claims["user_metadata"] ?? {}) as { full_name?: string };
    const link = await createProCheckout({
      txRef,
      amount: PRO_PRICE,
      email,
      name: meta.full_name ?? "",
      orgName: org.name,
      redirectUrl: `${siteUrl()}/billing/callback`,
    });
    return { link };
  });

/** Back from the Flutterwave page: checks the payment with Flutterwave and records it. */
export const confirmProPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { transactionId: string; txRef: string }) => ({
    transactionId: String(input.transactionId ?? "").trim(),
    txRef: String(input.txRef ?? "").trim(),
  }))
  .handler(async ({ data, context }) => {
    if (!/^\d+$/.test(data.transactionId))
      return { outcome: "ignored" as const, reason: "no payment" };
    const supabase = context.supabase as unknown as UserClient;
    const { data: appContext } = await supabase.rpc("app_context");
    const orgId = (appContext as AppContext | null)?.org?.id;
    if (!orgId) throw new Error("Organization not found.");

    const { applyTransaction } = await import("@/lib/flutterwave");
    const { flutterwaveDeps } = await import("@/lib/billing.server");
    const deps = await flutterwaveDeps();
    const tx = await deps.verifyTransaction(data.transactionId);
    if (!tx || tx.tx_ref !== data.txRef) {
      return { outcome: "ignored" as const, reason: "payment not found" };
    }
    const result = await applyTransaction(tx, deps, orgId);
    return result.outcome === "ignored"
      ? { outcome: "ignored" as const, reason: result.reason }
      : { outcome: result.outcome };
  });

/** Stops future monthly charges. The time already paid for stays. */
export const cancelAutoRenew = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as unknown as UserClient;
    const org = await requireBillingManager(supabase);
    const { data: billing } = await supabase
      .from("org_billing")
      .select("provider_email")
      .maybeSingle();
    const { cancelSubscriptions } = await import("@/lib/flutterwave.server");
    if (billing?.provider_email) await cancelSubscriptions(billing.provider_email);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("mark_auto_renew_cancelled", { _org_id: org.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
