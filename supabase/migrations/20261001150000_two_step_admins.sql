-- TWO-STEP LOGIN FOR SUPER ADMINS
-- A super admin's powers (the console, support sessions, wiping, adding super admins) now work only
-- in a sign-in confirmed with a code from an authenticator app: Supabase marks such a session's
-- JWT with aal = 'aal2'. A stolen password or Google session alone gets nothing.
-- Super admins without it still see the System admin link, which asks them to set it up or to
-- enter their code.

-- Was this sign-in confirmed with a two-step code?
CREATE OR REPLACE FUNCTION public.signed_in_with_two_steps()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- On the super admin list, whatever the sign-in.
CREATE OR REPLACE FUNCTION public.is_platform_admin_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;

-- A super admin with their powers: on the list and signed in with two steps.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin_member() AND public.signed_in_with_two_steps()
$$;

CREATE OR REPLACE FUNCTION public.require_platform_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin_member() THEN
    RAISE EXCEPTION 'Only FinSeka system admins can do this.';
  END IF;
  IF NOT public.signed_in_with_two_steps() THEN
    RAISE EXCEPTION 'Enter your two-step login code first.';
  END IF;
END;
$$;

-- A support session only counts in a two-step sign-in.
CREATE OR REPLACE FUNCTION public.active_support_session()
RETURNS public.support_sessions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.*
  FROM public.support_sessions s
  JOIN public.platform_admins a ON a.user_id = s.admin_id
  WHERE s.admin_id = auth.uid() AND s.ended_at IS NULL AND s.expires_at > now()
    AND public.signed_in_with_two_steps()
  ORDER BY s.started_at DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.app_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'org', (SELECT jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url,
                                      'opening_balance_set', o.opening_balance_set)
            FROM public.organizations o WHERE o.id = public.current_org_id()),
    'is_admin', public.is_org_admin(),
    'is_platform_admin', public.is_platform_admin(),
    'is_platform_admin_member', public.is_platform_admin_member(),
    'support', (SELECT jsonb_build_object('org_id', s.org_id, 'reason', s.reason,
                                          'started_at', s.started_at, 'expires_at', s.expires_at)
                FROM public.active_support_session() s WHERE s.id IS NOT NULL))
$$;

-- The super admin list shows who has two-step login switched on.
DROP FUNCTION IF EXISTS public.admin_list_admins();
CREATE FUNCTION public.admin_list_admins()
RETURNS TABLE (user_id uuid, email text, full_name text, added_at timestamptz, added_by_email text,
               last_sign_in_at timestamptz, is_you boolean, two_step boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  SELECT a.user_id, u.email, p.full_name, a.added_at, b.email, u.last_sign_in_at, a.user_id = auth.uid(),
         EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status = 'verified')
  FROM public.platform_admins a
  LEFT JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.profiles p ON p.id = a.user_id
  LEFT JOIN auth.users b ON b.id = a.added_by
  ORDER BY a.added_at;
END;
$$;

REVOKE ALL ON FUNCTION public.signed_in_with_two_steps() FROM anon, public;
REVOKE ALL ON FUNCTION public.is_platform_admin_member() FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_list_admins() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.signed_in_with_two_steps() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_admins() TO authenticated;
