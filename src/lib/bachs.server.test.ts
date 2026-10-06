import { afterEach, describe, expect, it, vi } from "vitest";

import { bachsConfig } from "./bachs.server";

afterEach(() => vi.unstubAllEnvs());

describe("bachsConfig", () => {
  it("sends a live key to the live server, even if BACHS_API_URL says sandbox", () => {
    vi.stubEnv("BACHS_SECRET_KEY", "sk_live_abc");
    vi.stubEnv("BACHS_API_URL", "https://sandbox-api.bachs.io");
    expect(bachsConfig().apiUrl).toBe("https://api.bachs.io");
  });

  it("sends a sandbox key to the sandbox, even if BACHS_API_URL says live", () => {
    vi.stubEnv("BACHS_SECRET_KEY", "sk_sandbox_abc");
    vi.stubEnv("BACHS_API_URL", "https://api.bachs.io");
    expect(bachsConfig().apiUrl).toBe("https://sandbox-api.bachs.io");
  });

  it("uses BACHS_API_URL only for a key of another shape", () => {
    vi.stubEnv("BACHS_SECRET_KEY", "other_key");
    vi.stubEnv("BACHS_API_URL", "https://api.bachs.io/");
    expect(bachsConfig().apiUrl).toBe("https://api.bachs.io");
  });

  it("ignores spaces and quote marks pasted around the settings", () => {
    vi.stubEnv("BACHS_SECRET_KEY", ' "sk_live_abc" ');
    vi.stubEnv("BACHS_WEBHOOK_SECRET", "'whsec_xyz'");
    expect(bachsConfig()).toMatchObject({
      secretKey: "sk_live_abc",
      webhookSecret: "whsec_xyz",
      apiUrl: "https://api.bachs.io",
      online: true,
    });
  });

  it("is off without a key", () => {
    vi.stubEnv("BACHS_SECRET_KEY", "");
    expect(bachsConfig().online).toBe(false);
  });
});
