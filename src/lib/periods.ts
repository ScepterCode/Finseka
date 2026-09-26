import { localIso } from "@/lib/format";

export type Frequency = "daily" | "weekly" | "monthly" | "yearly" | "custom";

export const frequencyLabels: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
  custom: "Whenever",
};

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekNumber(d: Date) {
  const start = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - start.getTime()) / 86400000);
  return Math.ceil((days + start.getDay() + 1) / 7);
}

export type PeriodEntry = { label: string; ends_on: string | null };

/** Weeks run Sunday to Saturday (matching weekNumber) and never cross into the next year. */
function weekEnd(d: Date) {
  const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - d.getDay()));
  return sat.getFullYear() > d.getFullYear() ? new Date(d.getFullYear(), 11, 31) : sat;
}

/** Periods newest first, with the last day of each. The label is the key on a payment row. */
export function periodEntries(frequency: Frequency): PeriodEntry[] {
  const now = new Date();
  const out: PeriodEntry[] = [];

  if (frequency === "monthly") {
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        label: `${months[d.getMonth()]} ${d.getFullYear()}`,
        ends_on: localIso(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      });
    }
    return out;
  }
  if (frequency === "yearly") {
    for (let i = 0; i < 6; i++) {
      const y = now.getFullYear() - i;
      out.push({ label: String(y), ends_on: `${y}-12-31` });
    }
    return out;
  }
  if (frequency === "weekly") {
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
      out.push({
        label: `Week ${weekNumber(d)}, ${d.getFullYear()}`,
        ends_on: localIso(weekEnd(d)),
      });
    }
    return out;
  }
  if (frequency === "daily") {
    for (let i = 0; i < 21; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push({
        label: `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`,
        ends_on: localIso(d),
      });
    }
    return out;
  }
  return [{ label: "All time", ends_on: null }];
}

/** Human labels used as the period key on a payment row. */
export function periodOptions(frequency: Frequency): string[] {
  return periodEntries(frequency).map((p) => p.label);
}

/** How many periods (current one included) count towards what a member owes. */
export const STANDING_LOOKBACK = 6;

/** The periods the database's standing functions should look at, for every frequency. */
export function standingPeriods(): Record<Frequency, PeriodEntry[]> {
  const frequencies: Frequency[] = ["daily", "weekly", "monthly", "yearly", "custom"];
  return Object.fromEntries(
    frequencies.map((f) => [f, periodEntries(f).slice(0, STANDING_LOOKBACK)]),
  ) as Record<Frequency, PeriodEntry[]>;
}

export function currentPeriod(frequency: Frequency): string {
  return periodOptions(frequency)[0] ?? "All time";
}

/** A period is "overdue" when it is not the current one (it has already passed). */
export function isPastPeriod(frequency: Frequency, period: string) {
  if (frequency === "custom") return false;
  return period !== currentPeriod(frequency);
}
