import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  applyCheckout,
  handleBachsWebhook,
  verifyBachsSignature,
  type BachsCheckout,
  type BachsDeps,
} from "./bachs";

const SECRET = "whsec_test_secret";
const NOW = 1_790_000_000;

// Shaped like Bachs's GET /v1/checkout-sessions/{id} once a naira checkout is paid (as the
// sandbox really returns it: payment_status "succeeded", where webhooks say "paid").
const paid = (over: Partial<BachsCheckout> = {}): BachsCheckout => ({
  checkout_id: "chk_abc",
  status: "completed",
  payment_status: "succeeded",
  amount: "10000.00",
  currency: "NGN",
  reference: "finseka-ref-1",
  completed_at: "2026-10-06T10:00:00Z",
  charge: { status: "succeeded", amount_paid: "10000.00" },
  customer: { email: "treasurer@church.ng" },
  ...over,
});

function deps(over: Partial<BachsDeps> = {}): BachsDeps {
  return {
    webhookSecret: SECRET,
    price: 5000,
    fetchCheckout: vi.fn(async () => paid()),
    checkoutFor: vi.fn(async (ref: string) =>
      ref === "finseka-ref-1" ? { orgId: "org-1", months: 2 } : null,
    ),
    recordPayment: vi.fn(async () => ({ duplicate: false })),
    ...over,
  };
}

const sign = (body: string, t = NOW, secret = SECRET) =>
  createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

const v2 = (body: string, t = NOW, secret = SECRET) =>
  new Headers({ "X-Bachs-Signature-V2": `t=${t},v1=${sign(body, t, secret)}` });

const event = (
  type = "checkout.completed",
  data: Record<string, unknown> = { checkout_id: "chk_abc" },
) => JSON.stringify({ id: "evt_1", type, data });

describe("verifyBachsSignature", () => {
  const body = event();

  it("accepts the V2 header, and any of its signatures during a secret rotation", async () => {
    expect(await verifyBachsSignature(v2(body), body, SECRET, NOW)).toBe(true);
    const rotating = new Headers({
      "X-Bachs-Signature-V2": `t=${NOW},v1=${sign(body, NOW, "whsec_old")},v1=${sign(body)}`,
    });
    expect(await verifyBachsSignature(rotating, body, SECRET, NOW)).toBe(true);
  });

  it("accepts the older timestamp + signature headers", async () => {
    const h = new Headers({ "X-Bachs-Timestamp": String(NOW), "X-Bachs-Signature": sign(body) });
    expect(await verifyBachsSignature(h, body, SECRET, NOW)).toBe(true);
  });

  it("accepts a secret used without its whsec_ prefix", async () => {
    expect(await verifyBachsSignature(v2(body, NOW, "test_secret"), body, SECRET, NOW)).toBe(true);
  });

  it("refuses a wrong secret, a changed body, a missing header and an old delivery", async () => {
    expect(await verifyBachsSignature(v2(body, NOW, "whsec_guess"), body, SECRET, NOW)).toBe(false);
    expect(await verifyBachsSignature(v2(body), body + " ", SECRET, NOW)).toBe(false);
    expect(await verifyBachsSignature(new Headers(), body, SECRET, NOW)).toBe(false);
    expect(await verifyBachsSignature(v2(body, NOW - 301), body, SECRET, NOW)).toBe(false);
  });
});

describe("handleBachsWebhook", () => {
  it("refuses everything until Bachs is set up", async () => {
    const body = event();
    const r = await handleBachsWebhook(v2(body), body, deps({ webhookSecret: undefined }), NOW);
    expect(r.status).toBe(503);
  });

  it("refuses unsigned or wrongly signed calls", async () => {
    const d = deps();
    const body = event();
    expect((await handleBachsWebhook(new Headers(), body, d, NOW)).status).toBe(401);
    expect((await handleBachsWebhook(v2(body, NOW, "whsec_x"), body, d, NOW)).status).toBe(401);
    expect(d.fetchCheckout).not.toHaveBeenCalled();
    expect(d.recordPayment).not.toHaveBeenCalled();
  });

  it("records a paid checkout for the months it was started for", async () => {
    const d = deps();
    const body = event();
    const r = await handleBachsWebhook(v2(body), body, d, NOW);
    expect(r).toEqual({ status: 200, body: "recorded" });
    expect(d.fetchCheckout).toHaveBeenCalledWith("chk_abc");
    expect(d.recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        providerRef: "chk_abc",
        amount: 10000,
        currency: "NGN",
        months: 2,
      }),
    );
  });

  it("also acts on collection.succeeded, and says when it was already recorded", async () => {
    const d = deps({ recordPayment: vi.fn(async () => ({ duplicate: true })) });
    const body = event("collection.succeeded", { checkout_id: "chk_abc", amount: "10000.00" });
    expect((await handleBachsWebhook(v2(body), body, d, NOW)).body).toBe("duplicate");
  });

  it("trusts the checkout fetched from Bachs, not the webhook body", async () => {
    const d = deps({ fetchCheckout: vi.fn(async () => paid({ amount: "5000.00", charge: null })) });
    const body = event("collection.succeeded", { checkout_id: "chk_abc", amount: "10000.00" });
    const r = await handleBachsWebhook(v2(body), body, d, NOW);
    expect(r.body).toBe("ignored: amount does not cover the months paid for");
    expect(d.recordPayment).not.toHaveBeenCalled();
  });

  it("asks Bachs to try again later when Bachs cannot be reached", async () => {
    const d = deps({
      fetchCheckout: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    const body = event();
    expect((await handleBachsWebhook(v2(body), body, d, NOW)).status).toBe(502);
  });

  it("ignores other events and events without a checkout", async () => {
    const d = deps();
    const other = event("payout.paid", {});
    expect((await handleBachsWebhook(v2(other), other, d, NOW)).body).toBe("ignored: payout.paid");
    const deposit = event("collection.succeeded", { checkout_id: null });
    expect((await handleBachsWebhook(v2(deposit), deposit, d, NOW)).body).toBe(
      "ignored: no checkout",
    );
    expect(d.recordPayment).not.toHaveBeenCalled();
  });
});

describe("applyCheckout", () => {
  it("counts a completed checkout whether Bachs calls it succeeded or paid", async () => {
    expect((await applyCheckout(paid(), deps())).outcome).toBe("recorded");
    expect((await applyCheckout(paid({ payment_status: "paid" }), deps())).outcome).toBe(
      "recorded",
    );
  });

  it("ignores unpaid, expired or non-naira checkouts", async () => {
    const d = deps();
    expect(
      (await applyCheckout(paid({ status: "open", payment_status: "requires_payment_method" }), d))
        .outcome,
    ).toBe("ignored");
    expect((await applyCheckout(paid({ status: "expired" }), d)).outcome).toBe("ignored");
    expect((await applyCheckout(paid({ currency: "USD" }), d)).outcome).toBe("ignored");
    expect(d.recordPayment).not.toHaveBeenCalled();
  });

  it("ignores checkouts FinSeka did not start", async () => {
    const r = await applyCheckout(paid({ reference: "someone-else" }), deps());
    expect(r).toEqual({ outcome: "ignored", reason: "no organization for this payment" });
    expect((await applyCheckout(paid({ reference: null }), deps())).outcome).toBe("ignored");
  });

  it("counts what was actually paid when less arrived than was asked", async () => {
    const r = await applyCheckout(paid({ charge: { amount_paid: "5000.00" } }), deps());
    expect(r).toEqual({ outcome: "ignored", reason: "amount does not cover the months paid for" });
  });

  it("refuses to record another organization's payment from the return page", async () => {
    const d = deps();
    const r = await applyCheckout(paid(), d, "org-2");
    expect(r).toEqual({ outcome: "ignored", reason: "payment belongs to another organization" });
    expect(d.recordPayment).not.toHaveBeenCalled();
  });
});
