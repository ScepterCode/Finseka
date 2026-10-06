// Decides what a Bachs payment means for FinSeka, without talking to Bachs or the database itself
// (those are passed in), so every path can be tested without live keys.
//
// Rules:
// * A webhook is only trusted when its signature (HMAC-SHA256 of "{timestamp}.{raw body}" with the
//   endpoint's signing secret) matches and it is less than 5 minutes old. Even then the checkout is
//   fetched again from Bachs before anything is recorded: the webhook body is never trusted.
// * A checkout counts only if it is completed and paid, in naira, and the amount covers every
//   month it was started for (1 to 12, chosen by the admin and stored with its reference).
// * The checkout is matched to its organization by the reference FinSeka created for it.
// * Recording is idempotent (keyed on the checkout id): Bachs may send the same event more than
//   once, and the return page records it too.

export type BachsCheckout = {
  checkout_id: string;
  status: string;
  payment_status?: string | null;
  amount: string;
  currency: string | null;
  reference: string | null;
  completed_at?: string | null;
  charge?: { status?: string | null; amount_paid?: string | null } | null;
  customer?: { email?: string | null } | null;
};

export type BachsPaymentToRecord = {
  orgId: string;
  providerRef: string;
  amount: number;
  currency: string;
  months: number;
  paidAt: string | null;
  raw: BachsCheckout;
};

export type BachsDeps = {
  /** The endpoint's signing secret, from Bachs → Developer Portal → Webhooks. */
  webhookSecret: string | undefined;
  price: number;
  /** Fetches the checkout from Bachs; null if Bachs says it does not exist. Throws if Bachs cannot be reached. */
  fetchCheckout: (checkoutId: string) => Promise<BachsCheckout | null>;
  /** The organization and months FinSeka stored when it created the checkout. */
  checkoutFor: (reference: string) => Promise<{ orgId: string; months: number } | null>;
  recordPayment: (payment: BachsPaymentToRecord) => Promise<{ duplicate: boolean }>;
};

export type BachsResult =
  { outcome: "recorded" | "duplicate"; orgId: string } | { outcome: "ignored"; reason: string };

const TOLERANCE_SECONDS = 300;
const PAID_STATUSES = new Set(["paid", "succeeded"]);

async function hmacHex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings in constant time, so the comparison does not leak how much matched. */
function same(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Checks the X-Bachs-Signature-V2 header ("t=…,v1=…[,v1=…]"), or the older X-Bachs-Timestamp +
 * X-Bachs-Signature pair. During a secret rotation V2 carries one v1 per valid secret; any may match.
 */
export async function verifyBachsSignature(
  headers: Headers,
  rawBody: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  let timestamp: string | null = null;
  let signatures: string[] = [];
  const v2 = headers.get("x-bachs-signature-v2");
  if (v2) {
    for (const part of v2.split(",")) {
      const [k, ...rest] = part.trim().split("=");
      const v = rest.join("=");
      if (k === "t") timestamp = v;
      if (k === "v1" && v) signatures.push(v.toLowerCase());
    }
  } else {
    timestamp = headers.get("x-bachs-timestamp");
    const sig = headers.get("x-bachs-signature");
    signatures = sig ? [sig.trim().toLowerCase()] : [];
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  // The secret is used as shown in the portal; the bare part after "whsec_" is accepted as well,
  // since the docs do not say whether the prefix is part of the key.
  const keys = secret.startsWith("whsec_") ? [secret, secret.slice("whsec_".length)] : [secret];
  for (const key of keys) {
    const expected = await hmacHex(key, `${timestamp}.${rawBody}`);
    if (signatures.some((s) => same(s, expected))) return true;
  }
  return false;
}

/** Records a checkout fetched from Bachs against its organization, if it is a valid Pro payment. */
export async function applyCheckout(
  checkout: BachsCheckout,
  deps: BachsDeps,
  expectedOrgId?: string,
): Promise<BachsResult> {
  // Webhooks say "paid"; GET /v1/checkout-sessions/{id} says "succeeded" for the same checkout.
  const paymentStatus = String(checkout.payment_status ?? "").toLowerCase();
  if (checkout.status !== "completed" || !PAID_STATUSES.has(paymentStatus)) {
    return { outcome: "ignored", reason: "payment not completed" };
  }
  const target = checkout.reference ? await deps.checkoutFor(checkout.reference) : null;
  if (!target) return { outcome: "ignored", reason: "no organization for this payment" };
  if (expectedOrgId && target.orgId !== expectedOrgId) {
    return { outcome: "ignored", reason: "payment belongs to another organization" };
  }
  const paidText = checkout.charge?.amount_paid;
  const amount = paidText && Number(paidText) > 0 ? Number(paidText) : Number(checkout.amount);
  const currency = String(checkout.currency ?? "").toUpperCase();
  if (currency !== "NGN" || !(amount >= deps.price * target.months)) {
    return { outcome: "ignored", reason: "amount does not cover the months paid for" };
  }
  const { duplicate } = await deps.recordPayment({
    orgId: target.orgId,
    providerRef: checkout.checkout_id,
    amount,
    currency,
    months: target.months,
    paidAt: checkout.completed_at ?? null,
    raw: checkout,
  });
  return { outcome: duplicate ? "duplicate" : "recorded", orgId: target.orgId };
}

type Reply = { status: number; body: string };

/** Handles one webhook call from Bachs. 5xx replies make Bachs try again later. */
export async function handleBachsWebhook(
  headers: Headers,
  rawBody: string,
  deps: BachsDeps,
  nowSeconds?: number,
): Promise<Reply> {
  if (!deps.webhookSecret) return { status: 503, body: "Bachs is not set up" };
  if (!(await verifyBachsSignature(headers, rawBody, deps.webhookSecret, nowSeconds))) {
    return { status: 401, body: "Invalid signature" };
  }

  let payload: { type?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: "Invalid JSON" };
  }
  const type = String(payload.type ?? "");
  if (type !== "checkout.completed" && type !== "collection.succeeded") {
    return { status: 200, body: `ignored: ${type || "unknown event"}` };
  }

  const checkoutId = payload.data?.["checkout_id"];
  if (typeof checkoutId !== "string" || !checkoutId) {
    return { status: 200, body: "ignored: no checkout" };
  }
  let checkout: BachsCheckout | null;
  try {
    checkout = await deps.fetchCheckout(checkoutId);
  } catch {
    return { status: 502, body: "Could not check the payment with Bachs" };
  }
  if (!checkout) return { status: 200, body: "ignored: checkout not found" };
  const result = await applyCheckout(checkout, deps);
  return {
    status: 200,
    body: result.outcome === "ignored" ? `ignored: ${result.reason}` : result.outcome,
  };
}
