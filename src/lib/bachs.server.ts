// Calls to the Bachs API. Server code only: it uses the secret key.
//
// Settings (Vercel → Project → Settings → Environment Variables, and .env for local testing):
//   BACHS_SECRET_KEY      Bachs → Developer Portal → API keys (sk_sandbox_… to test, sk_live_… for real)
//   BACHS_WEBHOOK_SECRET  the signing secret of the webhook pointing at /api/bachs-webhook
//   BACHS_API_URL         optional; worked out from the key (sandbox or live) when left out
// When BACHS_SECRET_KEY is set, Bachs is the online way to pay (instead of Flutterwave).

import type { BachsCheckout } from "@/lib/bachs";

export function bachsConfig() {
  const secretKey = process.env["BACHS_SECRET_KEY"]?.trim() || undefined;
  const webhookSecret = process.env["BACHS_WEBHOOK_SECRET"]?.trim() || undefined;
  const apiUrl = (
    process.env["BACHS_API_URL"]?.trim() ||
    (secretKey?.startsWith("sk_live_") ? "https://api.bachs.io" : "https://sandbox-api.bachs.io")
  ).replace(/\/+$/, "");
  return { secretKey, webhookSecret, apiUrl, online: Boolean(secretKey) };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const { secretKey, apiUrl } = bachsConfig();
  if (!secretKey) throw new Error("Online payment is not set up yet.");
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, body };
}

/** Starts a one-off naira checkout and returns the Bachs page to send the payer to. */
export async function createBachsCheckout(input: {
  reference: string;
  amount: number;
  months: number;
  orgId: string;
  orgName: string;
  email: string;
  name: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const { status, body } = await call<{ checkout_url?: string; detail?: unknown }>(
    "/v1/checkout-sessions",
    {
      method: "POST",
      body: JSON.stringify({
        pricing: { currency: "NGN", amount: input.amount.toFixed(2) },
        customer: { email: input.email, ...(input.name ? { name: input.name } : {}) },
        reference: input.reference,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: {
          org_id: input.orgId,
          organization: input.orgName.slice(0, 200),
          months: String(input.months),
          product: "FinSeka Pro",
        },
      }),
    },
  );
  if (status >= 300 || !body.checkout_url) {
    console.warn(`[bachs] checkout failed ${status} ${JSON.stringify(body).slice(0, 300)}`);
    throw new Error("Could not start the payment. Please try again in a few minutes.");
  }
  return body.checkout_url;
}

/** The checkout as Bachs has it now; null if Bachs does not know it. Throws if Bachs cannot be reached. */
export async function getBachsCheckout(checkoutId: string): Promise<BachsCheckout | null> {
  if (!/^chk_[A-Za-z0-9]+$/.test(checkoutId)) return null;
  const { status, body } = await call<BachsCheckout>(
    `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`,
  );
  if (status === 404 || status === 400) return null;
  if (status >= 300) throw new Error(`Bachs answered ${status}`);
  return body;
}
