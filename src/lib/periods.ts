export type Frequency = "daily" | "weekly" | "monthly" | "yearly" | "custom";

export const frequencyLabels: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
  custom: "Whenever",
};

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function weekNumber(d: Date) {
  const start = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - start.getTime()) / 86400000);
  return Math.ceil((days + start.getDay() + 1) / 7);
}

/** Human labels used as the period key on a payment row. */
export function periodOptions(frequency: Frequency): string[] {
  const now = new Date();
  const out: string[] = [];

  if (frequency === "monthly") {
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(`${months[d.getMonth()]} ${d.getFullYear()}`);
    }
    return out;
  }
  if (frequency === "yearly") {
    for (let i = 0; i < 6; i++) out.push(String(now.getFullYear() - i));
    return out;
  }
  if (frequency === "weekly") {
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getTime() - i * 7 * 86400000);
      out.push(`Week ${weekNumber(d)}, ${d.getFullYear()}`);
    }
    return out;
  }
  if (frequency === "daily") {
    for (let i = 0; i < 21; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      out.push(`${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`);
    }
    return out;
  }
  return ["All time"];
}

export function currentPeriod(frequency: Frequency): string {
  return periodOptions(frequency)[0] ?? "All time";
}

/** A period is "overdue" when it is not the current one (it has already passed). */
export function isPastPeriod(frequency: Frequency, period: string) {
  if (frequency === "custom") return false;
  return period !== currentPeriod(frequency);
}
