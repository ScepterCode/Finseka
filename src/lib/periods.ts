// Due periods (their dates, labels and amounts) are worked out by the database:
// see due_periods() and due_period_list() in supabase/migrations/*_periods_as_dates.sql.

export type Frequency = "daily" | "weekly" | "monthly" | "yearly" | "custom";

export const frequencyLabels: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
  custom: "Whenever",
};
