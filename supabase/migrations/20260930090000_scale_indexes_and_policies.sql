-- SCALE: indexes and faster security rules. Changes no results, only how fast they come back.
--
-- 1. Postgres does not index foreign keys by itself, so most tables had no way to find one
--    organization's rows without reading every organization's rows. Every page paid for
--    that, and the cost grew with the number of organizations on FinSeka.
-- 2. The security rules called current_org_id() / is_org_admin() / auth.uid() directly, which
--    Postgres may re-run for every row it reads. Wrapped in (SELECT ...) they run once per
--    query. Each rule below is the one already in place, only wrapped; ALTER POLICY swaps it
--    in place, so no table is ever without its rule.
--
-- Index builds briefly block writes to their table (reads carry on). lock_timeout makes the
-- migration give up, and change nothing, rather than queue behind a long-running query.

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
-- Finding one organization's rows (every page, every security rule).
CREATE INDEX IF NOT EXISTS profiles_org_idx ON public.profiles (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_roles_org_idx ON public.user_roles (org_id);
CREATE INDEX IF NOT EXISTS branches_org_idx ON public.branches (org_id);
CREATE INDEX IF NOT EXISTS members_org_idx ON public.members (org_id);
CREATE INDEX IF NOT EXISTS dues_org_idx ON public.dues (org_id);
CREATE INDEX IF NOT EXISTS due_rates_org_idx ON public.due_rates (org_id);
CREATE INDEX IF NOT EXISTS due_members_org_idx ON public.due_members (org_id);
CREATE INDEX IF NOT EXISTS due_payments_org_idx ON public.due_payments (org_id);
CREATE INDEX IF NOT EXISTS contributions_org_idx ON public.contributions (org_id);
CREATE INDEX IF NOT EXISTS contribution_members_org_idx ON public.contribution_members (org_id);
CREATE INDEX IF NOT EXISTS contribution_payments_org_idx ON public.contribution_payments (org_id);
CREATE INDEX IF NOT EXISTS contribution_expenses_org_idx ON public.contribution_expenses (org_id);
CREATE INDEX IF NOT EXISTS pledge_payments_org_idx ON public.pledge_payments (org_id);

-- One member's records (member profile, balances) and removing a member or branch.
CREATE INDEX IF NOT EXISTS members_branch_idx ON public.members (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS due_members_member_idx ON public.due_members (member_id);
CREATE INDEX IF NOT EXISTS due_payments_member_idx ON public.due_payments (member_id);
CREATE INDEX IF NOT EXISTS contribution_members_member_idx ON public.contribution_members (member_id);
CREATE INDEX IF NOT EXISTS contribution_payments_member_idx ON public.contribution_payments (member_id);
CREATE INDEX IF NOT EXISTS ledger_entries_member_idx ON public.ledger_entries (member_id) WHERE member_id IS NOT NULL;

-- Event spending by event, and the ledger rows behind a payment (voiding a payment).
CREATE INDEX IF NOT EXISTS contribution_expenses_contribution_idx ON public.contribution_expenses (contribution_id);
CREATE INDEX IF NOT EXISTS ledger_entries_source_idx ON public.ledger_entries (source_table, source_id) WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SECURITY RULES: same conditions, helper calls run once per query
-- ---------------------------------------------------------------------------
ALTER POLICY audit_log_select ON public.audit_log
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY branches_select ON public.branches
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY branches_write ON public.branches
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY contribution_expenses_select ON public.contribution_expenses
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY contribution_expenses_write ON public.contribution_expenses
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin()) AND (NOT (EXISTS ( SELECT 1
   FROM public.contributions c
  WHERE ((c.id = contribution_expenses.contribution_id) AND c.expenses_posted))))))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin()) AND (NOT (EXISTS ( SELECT 1
   FROM public.contributions c
  WHERE ((c.id = contribution_expenses.contribution_id) AND c.expenses_posted))))));
ALTER POLICY contribution_members_select ON public.contribution_members
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY contribution_members_write ON public.contribution_members
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY contribution_payments_select ON public.contribution_payments
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY contribution_payments_write ON public.contribution_payments
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY contributions_select ON public.contributions
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY contributions_write ON public.contributions
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY due_members_select ON public.due_members
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY due_members_write ON public.due_members
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY due_payments_select ON public.due_payments
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY due_payments_write ON public.due_payments
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY due_rates_select ON public.due_rates
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY dues_select ON public.dues
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY dues_write ON public.dues
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY fiscal_years_select ON public.fiscal_years
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY ledger_insert_manual ON public.ledger_entries
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin()) AND (source_table IS NULL) AND (source_id IS NULL)));
ALTER POLICY ledger_select ON public.ledger_entries
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY members_select ON public.members
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY members_write ON public.members
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY admins_can_update_org ON public.organizations
  USING (((id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY org_members_can_view_org ON public.organizations
  USING ((id = (SELECT public.current_org_id())));
ALTER POLICY pledge_drives_select ON public.pledge_drives
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY pledge_drives_write ON public.pledge_drives
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY pledge_payments_insert ON public.pledge_payments
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin()) AND (voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)));
ALTER POLICY pledge_payments_select ON public.pledge_payments
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY pledges_select ON public.pledges
  USING ((org_id = (SELECT public.current_org_id())));
ALTER POLICY pledges_write ON public.pledges
  USING (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())))
  WITH CHECK (((org_id = (SELECT public.current_org_id())) AND (SELECT public.is_org_admin())));
ALTER POLICY update_own_profile ON public.profiles
  USING ((id = (SELECT auth.uid())))
  WITH CHECK ((id = (SELECT auth.uid())));
ALTER POLICY view_profiles_in_org ON public.profiles
  USING (((id = (SELECT auth.uid())) OR ((org_id IS NOT NULL) AND (org_id = (SELECT public.current_org_id())))));
ALTER POLICY view_roles_in_org ON public.user_roles
  USING ((org_id = (SELECT public.current_org_id())));

RESET lock_timeout;
