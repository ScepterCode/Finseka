import { describe, expect, it } from "vitest";

import { securityHeaders, withSecurityHeaders } from "./security-headers";

describe("securityHeaders", () => {
  it("allows exactly our Supabase project for data", () => {
    const csp = securityHeaders("https://abcd.supabase.co")["Content-Security-Policy"];
    expect(csp).toContain("connect-src 'self' https://abcd.supabase.co wss://abcd.supabase.co");
    expect(csp).toContain("img-src 'self' data: blob: https://abcd.supabase.co");
  });

  it("falls back to any Supabase project if the address is missing", () => {
    const csp = securityHeaders(undefined)["Content-Security-Policy"];
    expect(csp).toContain("https://*.supabase.co");
  });

  it("forbids framing and scripts from elsewhere", () => {
    const h = securityHeaders("https://abcd.supabase.co");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(h["X-Frame-Options"]).toBe("DENY");
  });
});

describe("withSecurityHeaders", () => {
  it("adds the headers and keeps the body, status and existing headers", async () => {
    const original = new Response("hello", {
      status: 201,
      headers: { "content-type": "text/plain", "x-frame-options": "SAMEORIGIN" },
    });
    const r = withSecurityHeaders(original, "https://abcd.supabase.co");
    expect(r.status).toBe(201);
    expect(await r.text()).toBe("hello");
    expect(r.headers.get("content-type")).toBe("text/plain");
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("Sentry in the policy", () => {
  it("allows Sentry's ingest host only when a DSN is set", () => {
    const off = securityHeaders("https://abcd.supabase.co")["Content-Security-Policy"];
    const on = securityHeaders(
      "https://abcd.supabase.co",
      "https://key@o123.ingest.de.sentry.io/456",
    )["Content-Security-Policy"];
    expect(off).not.toContain("sentry");
    expect(on).toContain("https://o123.ingest.de.sentry.io");
  });
});
