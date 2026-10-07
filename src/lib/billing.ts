import type { Billing } from "@/hooks/useAuth";
import { shortDate } from "@/lib/format";

const DAY = 24 * 60 * 60 * 1000;

/** The standard monthly price, shown crossed out next to the launch price actually charged. */
export const PRO_STANDARD_PRICE = 7000;

export function daysUntil(at: string | null | undefined, now = Date.now()) {
  if (!at) return 0;
  return Math.max(0, Math.ceil((new Date(at).getTime() - now) / DAY));
}

/** One sentence on where the organization stands, e.g. "Free trial — 12 days left". */
export function billingSummary(b: Billing, now = Date.now()) {
  switch (b.status) {
    case "free":
      return "Free plan, given by FinSeka";
    case "active":
      return `Pro — paid until ${shortDate(b.paid_until)}${b.auto_renew ? ", renews automatically" : ""}`;
    case "trial": {
      const left = daysUntil(b.trial_ends_at, now);
      return `Free trial — ${left} day${left === 1 ? "" : "s"} left (ends ${shortDate(b.trial_ends_at)})`;
    }
    case "grace":
      return `Payment overdue — pay by ${shortDate(b.grace_ends_at)} to keep recording`;
    case "read_only":
      return "Plan ended — records can be seen but not changed, downloaded or printed";
  }
}
