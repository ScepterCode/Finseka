import { describe, expect, it } from "vitest";

import { describeAdminAction } from "./admin-activity";

describe("describeAdminAction", () => {
  it("names the organization", () => {
    expect(
      describeAdminAction({ action: "support_start", org_name: "Aba Union", details: null }),
    ).toBe("opened Aba Union as support");
    expect(
      describeAdminAction({ action: "view_history", org_name: "Aba Union", details: null }),
    ).toBe("read the History of Aba Union");
  });

  it("names the person for super admin changes", () => {
    expect(
      describeAdminAction({ action: "admin_added", org_name: null, details: { email: "t@x.ng" } }),
    ).toBe("made t@x.ng a super admin");
    expect(
      describeAdminAction({
        action: "admin_removed",
        org_name: null,
        details: { email: "t@x.ng" },
      }),
    ).toBe("removed t@x.ng as a super admin");
  });

  it("counts deleted logins, using the name kept after a wipe", () => {
    expect(
      describeAdminAction({
        action: "wipe_logins",
        org_name: null,
        details: { org_name: "Aba Union", deleted: 1 },
      }),
    ).toBe("deleted 1 login from Aba Union");
  });
});
