-- TEAM MANAGEMENT
-- Removing someone takes them out of the organization instead of deleting their login,
-- admins can change roles, the last admin cannot be removed or demoted, and invites
-- attach people in one atomic step.

-- ---------------------------------------------------------------------------
-- Called by admins from the app
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_team_member(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove yourself. Ask another admin to do it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND org_id = _org_id) THEN
    RAISE EXCEPTION 'That person is not in your organization.';
  END IF;

  -- Their login stays; they simply no longer belong to this organization.
  DELETE FROM public.user_roles WHERE user_id = _user_id AND org_id = _org_id;
  UPDATE public.profiles SET org_id = NULL, must_change_password = false WHERE id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _other_admins int;
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND org_id = _org_id) THEN
    RAISE EXCEPTION 'That person is not in your organization.';
  END IF;

  IF _role = 'viewer' THEN
    SELECT count(*) INTO _other_admins FROM public.user_roles
    WHERE org_id = _org_id AND role = 'admin' AND user_id <> _user_id;
    IF _other_admins = 0 THEN
      RAISE EXCEPTION 'Every organization needs at least one admin. Make someone else an admin first.';
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, org_id, role) VALUES (_user_id, _org_id, _role)
  ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role;
END;
$$;

-- Why the signed-in user may not delete their account yet (null = they may).
CREATE OR REPLACE FUNCTION public.account_deletion_blocker()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_org_admin()
     AND NOT EXISTS (SELECT 1 FROM public.user_roles
                     WHERE org_id = public.current_org_id() AND role = 'admin' AND user_id <> auth.uid())
     AND EXISTS (SELECT 1 FROM public.profiles
                 WHERE org_id = public.current_org_id() AND id <> auth.uid())
    THEN 'You are the only admin. Make someone else an admin before deleting your account.'
  END
$$;

-- ---------------------------------------------------------------------------
-- Called only by the server with the service role key (invites)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_id_for_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1
$$;

-- Puts a person in an organization with a role, in one transaction.
CREATE OR REPLACE FUNCTION public.attach_member(
  _user_id uuid,
  _org_id uuid,
  _role public.app_role,
  _full_name text,
  _must_change_password boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_org uuid;
BEGIN
  SELECT org_id INTO _current_org FROM public.profiles WHERE id = _user_id;
  IF _current_org = _org_id THEN
    RAISE EXCEPTION 'That person is already on your team.';
  ELSIF _current_org IS NOT NULL THEN
    RAISE EXCEPTION 'That email already belongs to another organization on FinSeka.';
  END IF;

  INSERT INTO public.profiles (id, org_id, full_name, must_change_password)
  VALUES (_user_id, _org_id, coalesce(nullif(trim(_full_name), ''), ''), _must_change_password)
  ON CONFLICT (id) DO UPDATE
    SET org_id = EXCLUDED.org_id,
        full_name = CASE WHEN public.profiles.full_name = '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
        must_change_password = EXCLUDED.must_change_password;

  INSERT INTO public.user_roles (user_id, org_id, role) VALUES (_user_id, _org_id, _role)
  ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_team_member(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.set_member_role(uuid, public.app_role) FROM anon, public;
REVOKE ALL ON FUNCTION public.account_deletion_blocker() FROM anon, public;
REVOKE ALL ON FUNCTION public.user_id_for_email(text) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.attach_member(uuid, uuid, public.app_role, text, boolean) FROM anon, public, authenticated;

GRANT EXECUTE ON FUNCTION public.remove_team_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_blocker() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_for_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_member(uuid, uuid, public.app_role, text, boolean) TO service_role;
