// Turns one row of the super admins' activity log into a plain sentence (after the admin's email),
// e.g. "opened Umuahia Town Union as support".

export type AdminActivity = {
  action: string;
  org_name: string | null;
  details: unknown;
};

export const adminActions: Record<string, string> = {
  support_start: "Opened as support",
  support_end: "Ended support session",
  view_history: "Read History",
  export: "Downloaded a copy",
  wipe: "Wiped out",
  wipe_logins: "Deleted logins",
  admin_added: "Added a super admin",
  admin_removed: "Removed a super admin",
  two_step_reset: "Reset two-step login",
  trial_extended: "Extended a trial",
  payment_recorded: "Recorded a payment",
  free_plan_given: "Gave a free plan",
  free_plan_removed: "Removed a free plan",
};

export function describeAdminAction(a: AdminActivity) {
  const org = a.org_name ?? "an organization";
  const details = (a.details ?? {}) as Record<string, unknown>;
  const email = typeof details["email"] === "string" ? details["email"] : "someone";
  switch (a.action) {
    case "support_start":
      return `opened ${org} as support`;
    case "support_end":
      return `ended a support session in ${org}`;
    case "view_history":
      return `read the History of ${org}`;
    case "export":
      return `downloaded a copy of ${org}`;
    case "wipe":
      return `wiped out ${org}`;
    case "wipe_logins": {
      const deleted = Number(details["deleted"] ?? 0);
      const name = typeof details["org_name"] === "string" ? details["org_name"] : org;
      return `deleted ${deleted} login${deleted === 1 ? "" : "s"} from ${name}`;
    }
    case "admin_added":
      return `made ${email} a super admin`;
    case "admin_removed":
      return `removed ${email} as a super admin`;
    case "trial_extended":
      return `extended the trial of ${org} by ${String(details["days"] ?? "")} days`;
    case "payment_recorded":
      return `recorded a payment of ₦${Number(details["amount"] ?? 0).toLocaleString("en-NG")} for ${org}`;
    case "free_plan_given":
      return `gave ${org} a free plan`;
    case "free_plan_removed":
      return `removed the free plan of ${org}`;
    case "two_step_reset":
      return `reset the two-step login of ${email}`;
    default:
      return `${a.action.replace(/_/g, " ")} ${org}`;
  }
}

/** "1 Oct 2026, 4:05 pm" */
export function when(at: string) {
  return new Date(at).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
