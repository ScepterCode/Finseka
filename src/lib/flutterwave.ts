// Decides what a Flutterwave payment means for FinSeka, without talking to Flutterwave or the
// database itself (those are passed in), so every path can be tested without live keys.
//
// Rules:
// * A webhook is only trusted when its verif-hash header equals the secret hash set in the
//   Flutterwave dashboard, and even then the transaction is fetched again from Flutterwave
//   ("verified") before anything is recorded: the webhook body is never trusted for the amount.
// * A payment counts only if it was successful, in naira, and at least one month of Pro.
// * The first payment is matched to its organization by the tx_ref FinSeka created at checkout;
//   monthly renewals (made by Flutterwave, with its own tx_ref) by the payer's email.
// * Recording is idempotent: Flutterwave may send the same event more than once.

export type FlwTransaction = {
  id: number | string;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
  created_at?: string;
  customer?: { email?: string | null; name?: string | null } | null;
};

export type PaymentToRecord = {
  orgId: string;
  providerRef: string;
  amount: number;
  currency: string;
  paidAt: string | null;
  email: string | null;
  raw: FlwTransaction;
};

export type FlutterwaveDeps = {
  /** The "secret hash" set in Flutterwave → Settings → Webhooks. */
  webhookHash: string | undefined;
  price: number;
  /** Fetches the transaction from Flutterwave; null if Flutterwave says it does not exist. Throws if Flutterwave cannot be reached. */
  verifyTransaction: (id: number | string) => Promise<FlwTransaction | null>;
  orgForCheckout: (txRef: string) => Promise<string | null>;
  orgForPayerEmail: (email: string) => Promise<string | null>;
  recordPayment: (payment: PaymentToRecord) => Promise<{ duplicate: boolean }>;
  markAutoRenewCancelled: (orgId: string) => Promise<void>;
};

export type ApplyResult =
  { outcome: "recorded" | "duplicate"; orgId: string } | { outcome: "ignored"; reason: string };

/** Compares two secrets in constant time, so the comparison does not leak how much matched. */
export function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Records a verified transaction against the right organization, if it is a valid Pro payment. */
export async function applyTransaction(
  tx: FlwTransaction,
  deps: FlutterwaveDeps,
  expectedOrgId?: string,
): Promise<ApplyResult> {
  if (String(tx.status).toLowerCase() !== "successful") {
    return { outcome: "ignored", reason: "payment not successful" };
  }
  if (String(tx.currency).toUpperCase() !== "NGN" || Number(tx.amount) < deps.price) {
    return { outcome: "ignored", reason: "amount does not cover a month of Pro" };
  }
  const email = tx.customer?.email?.trim() || null;
  const orgId =
    (await deps.orgForCheckout(tx.tx_ref)) ?? (email ? await deps.orgForPayerEmail(email) : null);
  if (!orgId) return { outcome: "ignored", reason: "no organization for this payment" };
  if (expectedOrgId && orgId !== expectedOrgId) {
    return { outcome: "ignored", reason: "payment belongs to another organization" };
  }
  const { duplicate } = await deps.recordPayment({
    orgId,
    providerRef: String(tx.id),
    amount: Number(tx.amount),
    currency: String(tx.currency).toUpperCase(),
    paidAt: tx.created_at ?? null,
    email,
    raw: tx,
  });
  return { outcome: duplicate ? "duplicate" : "recorded", orgId };
}

type Reply = { status: number; body: string };

/** Handles one webhook call from Flutterwave. 5xx replies make Flutterwave try again later. */
export async function handleFlutterwaveWebhook(
  headers: Headers,
  rawBody: string,
  deps: FlutterwaveDeps,
): Promise<Reply> {
  if (!deps.webhookHash) return { status: 503, body: "Flutterwave is not set up" };
  const signature = headers.get("verif-hash");
  if (!signature || !sameSecret(signature, deps.webhookHash)) {
    return { status: 401, body: "Invalid signature" };
  }

  let payload: { event?: string; "event.type"?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: "Invalid JSON" };
  }
  const event = String(payload.event ?? payload["event.type"] ?? "");
  const data = payload.data ?? {};

  if (event === "charge.completed" || event === "CARD_TRANSACTION") {
    const id = data["id"];
    if (typeof id !== "number" && typeof id !== "string")
      return { status: 400, body: "No transaction id" };
    let tx: FlwTransaction | null;
    try {
      tx = await deps.verifyTransaction(id);
    } catch {
      return { status: 502, body: "Could not verify with Flutterwave" };
    }
    if (!tx) return { status: 200, body: "ignored: transaction not found" };
    const result = await applyTransaction(tx, deps);
    return {
      status: 200,
      body: result.outcome === "ignored" ? `ignored: ${result.reason}` : result.outcome,
    };
  }

  if (event === "subscription.cancelled") {
    const customer = (data["customer"] ?? {}) as { email?: string };
    const orgId = customer.email ? await deps.orgForPayerEmail(customer.email) : null;
    if (!orgId) return { status: 200, body: "ignored: no organization for this subscription" };
    await deps.markAutoRenewCancelled(orgId);
    return { status: 200, body: "auto-renewal cancelled" };
  }

  return { status: 200, body: `ignored: ${event || "unknown event"}` };
}
