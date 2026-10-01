-- ADMIN CONSOLE: overview figures, every organization page by page, an organization's details and
-- History, managing super admins, and the full activity log of every super admin.
-- Everything here refuses anyone who is not a super admin. Reading an organization's History is
-- recorded in the activity log, so there is a trail of who looked at which organization.

-- Overview figures look across all organizations by date.
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON public.audit_log (at);
CREATE INDEX IF NOT EXISTS ledger_entries_entry_date_idx ON public.ledger_entries (entry_date);
CREATE INDEX IF NOT EXISTS organizations_created_at_idx ON public.organizations (created_at);
CREATE INDEX IF NOT EXISTS platform_audit_log_admin_idx ON public.platform_audit_log (admin_id, at DESC);

-- ---------------------------------------------------------------------------
-- OVERVIEW
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN jsonb_build_object(
    'organizations', (SELECT count(*) FROM public.organizations),
    'new_organizations_30d', (SELECT count(*) FROM public.organizations WHERE created_at > now() - interval '30 days'),
    'active_organizations_30d', (SELECT count(DISTINCT org_id) FROM public.audit_log WHERE at > now() - interval '30 days'),
    'members', (SELECT count(*) FROM public.members WHERE active),
    'logins', (SELECT count(*) FROM auth.users),
    'super_admins', (SELECT count(*) FROM public.platform_admins),
    'money_in_30d', (SELECT coalesce(sum(amount), 0) FROM public.ledger_entries
                     WHERE kind = 'income' AND entry_date > current_date - 30
                       AND reversed_at IS NULL AND reverses_id IS NULL),
    'open_support_sessions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'admin_email', u.email, 'org_id', s.org_id, 'org_name', o.name,
               'reason', s.reason, 'expires_at', s.expires_at) ORDER BY s.started_at DESC), '[]')
      FROM public.support_sessions s
      LEFT JOIN auth.users u ON u.id = s.admin_id
      LEFT JOIN public.organizations o ON o.id = s.org_id
      WHERE s.ended_at IS NULL AND s.expires_at > now())
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS
-- ---------------------------------------------------------------------------
-- Every organization, page by page. _sort: newest (default), name, active, members.
CREATE OR REPLACE FUNCTION public.admin_orgs(
  _search text DEFAULT NULL, _sort text DEFAULT 'newest', _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS TABLE (id uuid, name text, created_at timestamptz, members bigint, team bigint,
               admin_emails text, last_activity timestamptz, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _q text := nullif(trim(coalesce(_search, '')), '');
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  WITH admins AS (
    SELECT r.org_id, string_agg(u.email, ', ' ORDER BY u.email) AS emails
    FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
    WHERE r.role = 'admin'
    GROUP BY r.org_id
  ),
  org_rows AS (
    SELECT o.id, o.name, o.created_at,
           (SELECT count(*) FROM public.members m WHERE m.org_id = o.id) AS members,
           (SELECT count(*) FROM public.profiles p WHERE p.org_id = o.id) AS team,
           a.emails AS admin_emails,
           (SELECT max(l.at) FROM public.audit_log l WHERE l.org_id = o.id) AS last_activity
    FROM public.organizations o
    LEFT JOIN admins a ON a.org_id = o.id
    WHERE _q IS NULL OR o.name ILIKE '%' || _q || '%' OR a.emails ILIKE '%' || _q || '%'
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM org_rows r
  ORDER BY
    CASE WHEN _sort = 'name' THEN lower(r.name) END ASC,
    CASE WHEN _sort = 'active' THEN r.last_activity END DESC NULLS LAST,
    CASE WHEN _sort = 'members' THEN r.members END DESC,
    r.created_at DESC, r.id
  LIMIT least(greatest(_limit, 1), 200) OFFSET greatest(_offset, 0);
END;
$$;

-- One organization: counts, team, and its support sessions.
CREATE OR REPLACE FUNCTION public.admin_org_detail(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _out jsonb;
BEGIN
  PERFORM public.require_platform_admin();
  SELECT jsonb_build_object(
    'id', o.id, 'name', o.name, 'created_at', o.created_at,
    'created_by_email', (SELECT email FROM auth.users WHERE id = o.created_by),
    'counts', jsonb_build_object(
      'members', (SELECT count(*) FROM public.members WHERE org_id = o.id),
      'active_members', (SELECT count(*) FROM public.members WHERE org_id = o.id AND active),
      'branches', (SELECT count(*) FROM public.branches WHERE org_id = o.id),
      'dues', (SELECT count(*) FROM public.dues WHERE org_id = o.id),
      'contributions', (SELECT count(*) FROM public.contributions WHERE org_id = o.id),
      'due_payments', (SELECT count(*) FROM public.due_payments WHERE org_id = o.id),
      'contribution_payments', (SELECT count(*) FROM public.contribution_payments WHERE org_id = o.id),
      'pledges', (SELECT count(*) FROM public.pledges WHERE org_id = o.id),
      'ledger_entries', (SELECT count(*) FROM public.ledger_entries WHERE org_id = o.id),
      'history', (SELECT count(*) FROM public.audit_log WHERE org_id = o.id)),
    'last_activity', (SELECT max(at) FROM public.audit_log WHERE org_id = o.id),
    'team', (SELECT coalesce(jsonb_agg(jsonb_build_object(
               'user_id', p.id, 'full_name', p.full_name, 'email', u.email, 'role', r.role,
               'last_sign_in_at', u.last_sign_in_at,
               'provider', u.raw_app_meta_data ->> 'provider') ORDER BY r.role, p.full_name), '[]')
             FROM public.profiles p
             LEFT JOIN auth.users u ON u.id = p.id
             LEFT JOIN public.user_roles r ON r.user_id = p.id AND r.org_id = o.id
             WHERE p.org_id = o.id),
    'support_sessions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
               'admin_email', u.email, 'reason', s.reason, 'started_at', s.started_at,
               'expires_at', s.expires_at, 'ended_at', s.ended_at) ORDER BY s.started_at DESC), '[]')
             FROM (SELECT * FROM public.support_sessions WHERE org_id = o.id
                   ORDER BY started_at DESC LIMIT 50) s
             LEFT JOIN auth.users u ON u.id = s.admin_id)
  ) INTO _out
  FROM public.organizations o WHERE o.id = _org_id;

  IF _out IS NULL THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;
  RETURN _out;
END;
$$;

-- An organization's History, newest first. Opening it (the first page) is recorded.
CREATE OR REPLACE FUNCTION public.admin_org_history(_org_id uuid, _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS SETOF public.audit_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  IF _offset = 0 THEN
    PERFORM public.log_platform_action('view_history', _org_id, NULL);
  END IF;
  RETURN QUERY
  SELECT * FROM public.audit_log WHERE org_id = _org_id
  ORDER BY at DESC, id DESC
  LIMIT least(greatest(_limit, 1), 200) OFFSET greatest(_offset, 0);
END;
$$;

-- Names the History mentions (team, members, dues, contributions) for one organization.
CREATE OR REPLACE FUNCTION public.admin_org_names(_org_id uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  SELECT p.id, coalesce(nullif(p.full_name, ''), 'A team member') FROM public.profiles p WHERE p.org_id = _org_id
  UNION ALL SELECT m.id, m.name FROM public.members m WHERE m.org_id = _org_id
  UNION ALL SELECT d.id, d.name FROM public.dues d WHERE d.org_id = _org_id
  UNION ALL SELECT c.id, c.name FROM public.contributions c WHERE c.org_id = _org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- SUPER ADMINS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS TABLE (user_id uuid, email text, full_name text, added_at timestamptz, added_by_email text,
               last_sign_in_at timestamptz, is_you boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  SELECT a.user_id, u.email, p.full_name, a.added_at, b.email, u.last_sign_in_at, a.user_id = auth.uid()
  FROM public.platform_admins a
  LEFT JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.profiles p ON p.id = a.user_id
  LEFT JOIN auth.users b ON b.id = a.added_by
  ORDER BY a.added_at;
END;
$$;

-- Server code only: make an existing login a super admin, after checking the caller is one.
CREATE OR REPLACE FUNCTION public.grant_platform_admin(_user_id uuid, _by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _by) THEN
    RAISE EXCEPTION 'Only FinSeka system admins can do this.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'That person is already a super admin.';
  END IF;
  INSERT INTO public.platform_admins (user_id, added_by) VALUES (_user_id, _by);
  PERFORM public.log_platform_action('admin_added', NULL, NULL,
    jsonb_build_object('email', (SELECT email FROM auth.users WHERE id = _user_id)), _by);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_platform_admin(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text := (SELECT email FROM auth.users WHERE id = _user_id);
BEGIN
  PERFORM public.require_platform_admin();
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove yourself. Ask another super admin to do it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'That person is not a super admin.';
  END IF;
  DELETE FROM public.platform_admins WHERE user_id = _user_id;
  UPDATE public.support_sessions SET ended_at = now() WHERE admin_id = _user_id AND ended_at IS NULL;
  PERFORM public.log_platform_action('admin_removed', NULL, NULL, jsonb_build_object('email', _email));
END;
$$;

-- ---------------------------------------------------------------------------
-- ACTIVITY LOG: every super admin's actions, filterable
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_activity_page(
  _admin_id uuid DEFAULT NULL, _action text DEFAULT NULL, _org_id uuid DEFAULT NULL,
  _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS TABLE (id bigint, at timestamptz, admin_id uuid, admin_email text, action text, org_id uuid,
               org_name text, reason text, details jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  SELECT l.id, l.at, l.admin_id, l.admin_email, l.action, l.org_id, l.org_name, l.reason, l.details,
         count(*) OVER ()
  FROM public.platform_audit_log l
  WHERE (_admin_id IS NULL OR l.admin_id = _admin_id)
    AND (_action IS NULL OR l.action = _action)
    AND (_org_id IS NULL OR l.org_id = _org_id)
  ORDER BY l.at DESC, l.id DESC
  LIMIT least(greatest(_limit, 1), 200) OFFSET greatest(_offset, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_overview() FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_orgs(text, text, int, int) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_org_detail(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_org_history(uuid, int, int) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_org_names(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_list_admins() FROM anon, public;
REVOKE ALL ON FUNCTION public.grant_platform_admin(uuid, uuid) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.remove_platform_admin(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_activity_page(uuid, text, uuid, int, int) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.admin_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_orgs(text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_org_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_org_history(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_org_names(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_admins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_platform_admin(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_platform_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_page(uuid, text, uuid, int, int) TO authenticated;
-- The server adds a brand-new super admin's profile (no organization) when it creates their login.
GRANT EXECUTE ON FUNCTION public.user_id_for_email(text) TO service_role;
