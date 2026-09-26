-- DATA CHECKS
-- The database now refuses amounts and names that make no sense, whatever sends them.
-- Constraints are added NOT VALID first (so existing rows never block the migration)
-- and then validated; if old rows break a rule, that constraint still guards new and
-- edited rows and a notice names it.

ALTER TABLE public.dues
  ADD CONSTRAINT dues_amount_positive CHECK (amount > 0) NOT VALID,
  ADD CONSTRAINT dues_penalty_not_negative CHECK (penalty_amount >= 0) NOT VALID,
  ADD CONSTRAINT dues_grace_days_not_negative CHECK (penalty_grace_days >= 0) NOT VALID,
  ADD CONSTRAINT dues_name_present CHECK (length(trim(name)) > 0) NOT VALID;

ALTER TABLE public.contributions
  ADD CONSTRAINT contributions_amount_not_negative CHECK (amount_per_person >= 0) NOT VALID,
  ADD CONSTRAINT contributions_compulsory_has_amount CHECK (NOT mandatory OR amount_per_person > 0) NOT VALID,
  ADD CONSTRAINT contributions_target_not_negative CHECK (target_amount IS NULL OR target_amount >= 0) NOT VALID,
  ADD CONSTRAINT contributions_budget_not_negative CHECK (budget_amount IS NULL OR budget_amount >= 0) NOT VALID,
  ADD CONSTRAINT contributions_name_present CHECK (length(trim(name)) > 0) NOT VALID;

ALTER TABLE public.contribution_expenses
  ADD CONSTRAINT contribution_expenses_amount_positive CHECK (amount > 0) NOT VALID,
  ADD CONSTRAINT contribution_expenses_description_present CHECK (length(trim(description)) > 0) NOT VALID;

-- Ordinary lines are positive; reversal lines are the negative of what they reverse.
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_amount_sign CHECK (
    (reverses_id IS NULL AND amount > 0) OR (reverses_id IS NOT NULL AND amount < 0)
  ) NOT VALID,
  ADD CONSTRAINT ledger_entries_label_present CHECK (length(trim(label)) > 0) NOT VALID;

ALTER TABLE public.members
  ADD CONSTRAINT members_name_present CHECK (length(trim(name)) > 0) NOT VALID;
ALTER TABLE public.branches
  ADD CONSTRAINT branches_name_present CHECK (length(trim(name)) > 0) NOT VALID;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_name_present CHECK (length(trim(name)) > 0) NOT VALID;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE NOT convalidated AND contype = 'c' AND connamespace = 'public'::regnamespace
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'Existing rows break %, so it only guards new and edited rows.', c.conname;
    END;
  END LOOP;
END;
$$;
