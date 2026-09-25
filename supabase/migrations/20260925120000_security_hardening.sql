-- SECURITY HARDENING
-- 1. Users can no longer change their own org_id (or create a profile pointing at another org).
-- 2. Admin rights are scoped to the user's current organization.
-- 3. Role rows can only be written by trusted server code.
-- 4. must_change_password can only be cleared by the server after a real password change.
-- 5. Ledger rows created by triggers / posting functions are read-only for app users.

-- ---------------------------------------------------------------------------
-- PROFILES: column-level write access only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "insert_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "admins_update_profiles_in_org" ON public.profiles;

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;

CREATE POLICY "update_own_profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS: admins may only rename / change the logo
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.organizations FROM authenticated;
GRANT UPDATE (name, logo_url) ON public.organizations TO authenticated;

DROP POLICY IF EXISTS "admins_can_update_org" ON public.organizations;
CREATE POLICY "admins_can_update_org" ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (id = public.current_org_id() AND public.is_org_admin());

-- ---------------------------------------------------------------------------
-- USER ROLES: one role per user per organization, read-only for app users
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "admins_manage_roles_in_org" ON public.user_roles;
DROP POLICY IF EXISTS "view_roles_in_org" ON public.user_roles;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;

-- Attach org-less role rows to the user's organization, then drop any that are left.
UPDATE public.user_roles ur
SET org_id = p.org_id
FROM public.profiles p
WHERE ur.user_id = p.id AND ur.org_id IS NULL AND p.org_id IS NOT NULL;
DELETE FROM public.user_roles WHERE org_id IS NULL;

-- A user with both admin and viewer in the same org keeps admin.
DELETE FROM public.user_roles v
USING public.user_roles a
WHERE v.user_id = a.user_id
  AND v.org_id = a.org_id
  AND v.role = 'viewer'
  AND a.role = 'admin';

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_org_id_key UNIQUE (user_id, org_id);

CREATE POLICY "view_roles_in_org" ON public.user_roles
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- ROLE HELPERS: scoped to the organization
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.org_id = ur.org_id
    WHERE ur.user_id = _user_id AND ur.role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND org_id = public.current_org_id()
      AND role = 'admin'
  )
$$;

-- setup_organization referenced the old (user_id, role) key.
CREATE OR REPLACE FUNCTION public.setup_organization(_org_name text, _full_name text, _phone text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _org_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF length(trim(coalesce(_org_name, ''))) = 0 THEN
    RAISE EXCEPTION 'Enter the organization name.';
  END IF;

  SELECT org_id INTO _org_id FROM public.profiles WHERE id = _uid;
  IF _org_id IS NOT NULL THEN
    RETURN _org_id;
  END IF;

  INSERT INTO public.organizations (name, created_by) VALUES (trim(_org_name), _uid) RETURNING id INTO _org_id;

  INSERT INTO public.profiles (id, org_id, full_name, phone)
  VALUES (_uid, _org_id, coalesce(_full_name, ''), _phone)
  ON CONFLICT (id) DO UPDATE SET org_id = _org_id, full_name = coalesce(_full_name, public.profiles.full_name), phone = coalesce(_phone, public.profiles.phone);

  INSERT INTO public.user_roles (user_id, org_id, role) VALUES (_uid, _org_id, 'admin')
  ON CONFLICT (user_id, org_id) DO UPDATE SET role = 'admin';

  INSERT INTO public.branches (org_id, name) VALUES (_org_id, 'Main Branch');

  RETURN _org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- LEDGER: app users may only write manual entries
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "ledger_write" ON public.ledger_entries;

CREATE POLICY "ledger_insert_manual" ON public.ledger_entries
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin()
              AND source_table IS NULL AND source_id IS NULL);

CREATE POLICY "ledger_update_manual" ON public.ledger_entries
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin() AND source_table IS NULL)
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin()
              AND source_table IS NULL AND source_id IS NULL);

CREATE POLICY "ledger_delete_manual" ON public.ledger_entries
  FOR DELETE TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin() AND source_table IS NULL);

-- Posting event spending used to insert source-linked ledger rows from the browser.
-- It now happens here, atomically and only once per contribution.
CREATE OR REPLACE FUNCTION public.post_contribution_expenses(_contribution_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _name text;
  _posted boolean;
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;

  SELECT name, expenses_posted INTO _name, _posted
  FROM public.contributions
  WHERE id = _contribution_id AND org_id = _org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contribution not found.';
  END IF;
  IF _posted THEN
    RAISE EXCEPTION 'Spending for this event has already been posted.';
  END IF;

  INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, method, source_table, source_id)
  SELECT _org_id, 'expense', 'Event expenses',
         'Expenses from ' || _name || CASE WHEN e.method = 'transfer' THEN ' (bank)' ELSE ' (cash)' END,
         sum(e.amount), (now() AT TIME ZONE 'Africa/Lagos')::date, e.method, 'contributions', _contribution_id
  FROM public.contribution_expenses e
  WHERE e.contribution_id = _contribution_id AND e.org_id = _org_id
  GROUP BY e.method
  HAVING sum(e.amount) > 0;

  UPDATE public.contributions SET expenses_posted = true, closed = true WHERE id = _contribution_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- FUNCTION PRIVILEGES
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE ALL ON FUNCTION public.is_org_admin() FROM anon, public;
REVOKE ALL ON FUNCTION public.setup_organization(text, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.post_contribution_expenses(uuid) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.setup_organization(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_contribution_expenses(uuid) TO authenticated;
