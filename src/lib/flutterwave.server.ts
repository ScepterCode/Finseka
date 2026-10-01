// Calls to Flutterwave's v3 API. Server code only: it uses the secret key.
//
// Settings (Vercel → Project → Settings → Environment Variables, and .env for local testing):
//   FLUTTERWAVE_SECRET_KEY    Flutterwave → Settings → API keys (FLWSECK_TEST-… for test mode)
//   FLUTTERWAVE_PLAN_ID       the id of a monthly ₦5,000 payment plan (Payments → Plans)
//   FLUTTERWAVE_WEBHOOK_HASH  any long random text, also typed into Settings → Webhooks → Secret hash
// Until the first two are set, FinSeka offers bank transfer instead of online payment.

import type { FlwTransaction } from "@/lib/flutterwave";

const API = "https://api.flutterwave.com/v3";

export function flutterwaveConfig() {
  const secretKey = process.env["FLUTTERWAVE_SECRET_KEY"]?.trim() || undefined;
  const planId = process.env["FLUTTERWAVE_PLAN_ID"]?.trim() || undefined;
  const webhookHash = process.env["FLUTTERWAVE_WEBHOOK_HASH"]?.trim() || undefined;
  return { secretKey, planId, webhookHash, online: Boolean(secretKey && planId) };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const { secretKey } = flutterwaveConfig();
  if (!secretKey) throw new Error("Online payment is not set up yet.");
  const response = await fetch(`${API}${path}`, {
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

/** Starts a Flutterwave checkout for the monthly Pro plan and returns the page to send the payer to. */
export async function createProCheckout(input: {
  txRef: string;
  amount: number;
  email: string;
  name: string;
  orgName: string;
  redirectUrl: string;
}) {
  const { planId } = flutterwaveConfig();
  if (!planId) throw new Error("Online payment is not set up yet.");
  const { body } = await call<{ status?: string; message?: string; data?: { link?: string } }>(
    "/payments",
    {
      method: "POST",
      body: JSON.stringify({
        tx_ref: input.txRef,
        amount: input.amount,
        currency: "NGN",
        redirect_url: input.redirectUrl,
        payment_plan: Number(planId),
        customer: { email: input.email, name: input.name || input.email },
        customizations: {
          title: "FinSeka Pro",
          description: `FinSeka Pro for ${input.orgName}: ₦${input.amount.toLocaleString("en-NG")} a month`,
        },
      }),
    },
  );
  const link = body.data?.link;
  if (body.status !== "success" || !link) {
    throw new Error(body.message || "Flutterwave could not start the payment. Try again.");
  }
  return link;
}

/** The transaction as Flutterwave has it, or null if Flutterwave does not know it. Throws if unreachable. */
export async function verifyTransaction(id: number | string): Promise<FlwTransaction | null> {
  const { status, body } = await call<{ status?: string; data?: FlwTransaction }>(
    `/transactions/${encodeURIComponent(String(id))}/verify`,
  );
  if (status === 404 || status === 400) return null;
  if (status >= 500) throw new Error("Flutterwave is not responding.");
  return body.status === "success" && body.data ? body.data : null;
}

/** Stops future monthly charges for this payer's FinSeka Pro subscription(s). */
export async function cancelSubscriptions(email: string) {
  const { planId } = flutterwaveConfig();
  const { body } = await call<{
    data?: { id: number; status: string; plan?: number | string }[];
  }>(`/subscriptions?email=${encodeURIComponent(email)}`);
  const active = (body.data ?? []).filter(
    (s) => s.status === "active" && (!planId || String(s.plan) === String(planId)),
  );
  for (const s of active) {
    const { body: result } = await call<{ status?: string; message?: string }>(
      `/subscriptions/${s.id}/cancel`,
      { method: "PUT" },
    );
    if (result.status !== "success") {
      throw new Error(result.message || "Flutterwave could not cancel the subscription.");
    }
  }
  return active.length;
}
