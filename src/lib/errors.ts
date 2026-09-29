// Turns database and network errors into sentences a treasurer can act on.
// Errors raised by our own database functions ("Only an admin…", "Say why…") are
// already written for people, so they pass through unchanged.

const constraintMessages: Record<string, string> = {
  dues_amount_positive: "A due must be more than ₦0.",
  dues_penalty_not_negative: "The late charge cannot be less than ₦0.",
  dues_grace_days_not_negative: "Grace days cannot be less than 0.",
  dues_name_present: "Give the due a name.",
  contributions_amount_not_negative: "The amount per person cannot be less than ₦0.",
  contributions_compulsory_has_amount:
    "A compulsory contribution needs an amount each person pays. Enter one, or make it freewill.",
  contributions_target_not_negative: "The target cannot be less than ₦0.",
  contributions_budget_not_negative: "The budget cannot be less than ₦0.",
  contributions_name_present: "Give the contribution a name.",
  contribution_expenses_amount_positive: "Spending must be more than ₦0.",
  contribution_expenses_description_present: "Say what the money was spent on.",
  ledger_entries_amount_sign: "The amount must be more than ₦0.",
  ledger_entries_label_present: "Give the entry a label.",
  due_payments_amount_positive: "A payment must be more than ₦0.",
  contribution_payments_amount_positive: "A payment must be more than ₦0.",
  members_name_present: "Enter the member's name.",
  branches_name_present: "Enter the branch name.",
  organizations_name_present: "Enter the organization name.",
  members_email_shape: "That email address doesn't look right. Check it, or leave it blank.",
  members_gender_known: "Pick female or male, or leave it blank.",
  members_birth_date_sane: "Check the date of birth.",
  members_details_length: "One of the details is too long. Shorten it and try again.",
  pledges_name_present: "Enter the name of the person pledging.",
  pledges_for_one_thing: "Pick what the pledge is for.",
  pledges_details_length: "One of the details is too long. Shorten it and try again.",
  pledges_amount_check: "A pledge must be more than ₦0.",
  pledge_payments_amount_check: "A payment must be more than ₦0.",
  pledge_drives_name_check: "Give the pledge drive a name.",
  pledge_drives_target_amount_check: "The target cannot be less than ₦0.",
  pledge_payments_pledge_id_fkey:
    "This pledge has payments recorded, so it can't be deleted. Cancel it instead.",
};

type DbError = { message?: string; code?: string; details?: string | null };

export function friendlyError(error: unknown): string {
  const e = (error ?? {}) as DbError;
  const message = e.message ?? String(error);

  const constraint = Object.keys(constraintMessages).find((name) => message.includes(name));
  if (constraint) return constraintMessages[constraint]!;

  if (e.code === "42501" || /permission denied|row-level security/i.test(message)) {
    return "You don't have permission to do that. Only admins can make changes.";
  }
  if (e.code === "23505" || /duplicate key/i.test(message)) {
    return "That has already been saved.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Could not reach FinSeka. Check your internet connection and try again.";
  }
  return message;
}
