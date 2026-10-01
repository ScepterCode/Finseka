import { describe, expect, it, vi } from "vitest";

import {
  applyTransaction,
  handleFlutterwaveWebhook,
  sameSecret,
  type FlutterwaveDeps,
  type FlwTransaction,
} from "./flutterwave";

const HASH = "my-secret-hash";

// Shaped like Flutterwave v3's GET /transactions/:id/verify "data".
const paid = (over: Partial<FlwTransaction> = {}): FlwTransaction => ({
  id: 4123987,
  tx_ref: "finseka-abc-1",
  status: "successful",
  amount: 5000,
  currency: "NGN",
  created_at: "2026-10-01T10:00:00.000Z",
  customer: { email: "treasurer@church.ng", name: "Bola" },
  ...over,
});

function deps(over: Partial<FlutterwaveDeps> = {}): FlutterwaveDeps {
  return {
    webhookHash: HASH,
    price: 5000,
    verifyTransaction: vi.fn(async () => paid()),
    orgForCheckout: vi.fn(async (ref: string) => (ref === "finseka-abc-1" ? "org-1" : null)),
    orgForPayerEmail: vi.fn(async (email: string) =>
      email === "treasurer@church.ng" ? "org-1" : null,
    ),
    recordPayment: vi.fn(async () => ({ duplicate: false })),
    markAutoRenewCancelled: vi.fn(async () => {}),
    ...over,
  };
}

const headers = (hash: string | null = HASH) =>
  new Headers(hash === null ? {} : { "verif-hash": hash });

const charge = (id: number | string = 4123987, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ event: "charge.completed", data: { id, ...extra } });

describe("sameSecret", () => {
  it("matches only the exact secret", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret("", "abc")).toBe(false);
  });
});

describe("handleFlutterwaveWebhook", () => {
  it("refuses everything until Flutterwave is set up", async () => {
    const r = await handleFlutterwaveWebhook(headers(), charge(), deps({ webhookHash: undefined }));
    expect(r.status).toBe(503);
  });

  it("refuses calls without the secret hash, or with the wrong one", async () => {
    const d = deps();
    expect((await handleFlutterwaveWebhook(headers(null), charge(), d)).status).toBe(401);
    expect((await handleFlutterwaveWebhook(headers("guess"), charge(), d)).status).toBe(401);
    expect(d.recordPayment).not.toHaveBeenCalled();
  });

  it("records a first payment against the organization that started checkout", async () => {
    const d = deps();
    const r = await handleFlutterwaveWebhook(headers(), charge(), d);
    expect(r).toEqual({ status: 200, body: "recorded" });
    expect(d.verifyTransaction).toHaveBeenCalledWith(4123987);
    expect(d.recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        providerRef: "4123987",
        amount: 5000,
        currency: "NGN",
        email: "treasurer@church.ng",
      }),
    );
  });

  it("trusts the verified transaction, not the webhook body", async () => {
    const d = deps({ verifyTransaction: vi.fn(async () => paid({ amount: 100 })) });
    const body = charge(4123987, { amount: 5000, status: "successful" });
    const r = await handleFlutterwaveWebhook(headers(), body, d);
    expect(r.body).toBe("ignored: amount does not cover a month of Pro");
    expect(d.recordPayment).not.toHaveBeenCalled();
  });

  it("matches a monthly renewal by the payer's email", async () => {
    const d = deps({
      verifyTransaction: vi.fn(async () => paid({ id: 5550001, tx_ref: "flw-renewal-xyz" })),
    });
    const r = await handleFlutterwaveWebhook(headers(), charge(5550001), d);
    expect(r.body).toBe("recorded");
    expect(d.recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", providerRef: "5550001" }),
    );
  });

  it("says so when the same payment arrives twice", async () => {
    const d = deps({ recordPayment: vi.fn(async () => ({ duplicate: true })) });
    expect((await handleFlutterwaveWebhook(headers(), charge(), d)).body).toBe("duplicate");
  });

  it("asks Flutterwave to try again when it cannot be reached to verify", async () => {
    const d = deps({
      verifyTransaction: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    expect((await handleFlutterwaveWebhook(headers(), charge(), d)).status).toBe(502);
  });

  it("ignores failed payments, other currencies and unknown payers", async () => {
    for (const [tx, reason] of [
      [paid({ status: "failed" }), "payment not successful"],
      [paid({ currency: "USD" }), "amount does not cover a month of Pro"],
      [
        paid({ tx_ref: "someone-else", customer: { email: "stranger@x.ng" } }),
        "no organization for this payment",
      ],
    ] as const) {
      const d = deps({ verifyTransaction: vi.fn(async () => tx) });
      const r = await handleFlutterwaveWebhook(headers(), charge(), d);
      expect(r).toEqual({ status: 200, body: `ignored: ${reason}` });
      expect(d.recordPayment).not.toHaveBeenCalled();
    }
  });

  it("turns auto-renewal off when the subscription is cancelled", async () => {
    const d = deps();
    const body = JSON.stringify({
      event: "subscription.cancelled",
      data: { id: 77, status: "deactivated", customer: { email: "treasurer@church.ng" } },
    });
    const r = await handleFlutterwaveWebhook(headers(), body, d);
    expect(r.body).toBe("auto-renewal cancelled");
    expect(d.markAutoRenewCancelled).toHaveBeenCalledWith("org-1");
  });

  it("acknowledges events it does not need", async () => {
    const r = await handleFlutterwaveWebhook(
      headers(),
      JSON.stringify({ event: "transfer.completed", data: {} }),
      deps(),
    );
    expect(r).toEqual({ status: 200, body: "ignored: transfer.completed" });
  });

  it("rejects a body that is not JSON", async () => {
    expect((await handleFlutterwaveWebhook(headers(), "not json", deps())).status).toBe(400);
  });
});

describe("applyTransaction (returning from the Flutterwave checkout page)", () => {
  it("only records a payment for the organization that is checking out", async () => {
    const d = deps();
    const r = await applyTransaction(paid(), d, "org-2");
    expect(r).toEqual({ outcome: "ignored", reason: "payment belongs to another organization" });
    expect(d.recordPayment).not.toHaveBeenCalled();
    expect(await applyTransaction(paid(), deps(), "org-1")).toEqual({
      outcome: "recorded",
      orgId: "org-1",
    });
  });
});
