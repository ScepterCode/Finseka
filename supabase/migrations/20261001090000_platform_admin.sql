-- SYSTEM ADMIN: super admins, support sessions inside an organization, and wiping an organization.
--
-- * platform_admins: FinSeka staff. Separate from organization roles, so being an admin of an
--   organization never makes anyone a system admin, and the other way round.
-- * Support sessions: a super admin can work inside an organization for a limited time, with a
--   reason. current_org_id() / is_org_admin() follow the session, so every page, rule and function
--   works there unchanged. Changes are labelled "FinSeka support — <name>" in the organization's
--   History, the session's start and end show there too, and team changes are refused.
-- * Wiping: deletes an organization and every row it owns. Only server code can call it, and only
--   with the organization's exact name, a reason, and a copy downloaded in the last 30 minutes.
--   platform_audit_log has no foreign keys, so the record of the wipe survives it.

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------
CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin')),
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM anon, authenticated;
GRANT ALL ON public.platform_admins TO service_role;

CREATE TABLE public.support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  org_id uuid NOT NULL,          -- no foreign key: the record outlives a wiped organization
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE INDEX support_sessions_active_idx ON public.support_sessions (admin_id) WHERE ended_at IS NULL;
CREATE INDEX support_sessions_org_idx ON public.support_sessions (org_id, started_at DESC);
ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_sessions FROM anon, authenticated;
GRANT ALL ON public.support_sessions TO service_role;

CREATE TABLE public.platform_audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  admin_id uuid,
  admin_email text,
  action text NOT NULL,          -- support_start / support_end / export / wipe / wipe_logins
  org_id uuid,                   -- no foreign keys: this must survive the organization
  org_name text,
  reason text,
  details jsonb
);
CREATE INDEX platform_audit_log_at_idx ON public.platform_audit_log (at DESC, id DESC);
CREATE INDEX platform_audit_log_org_idx ON public.platform_audit_log (org_id, action, at DESC);
ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_audit_log FROM anon, authenticated;
GRANT ALL ON public.platform_audit_log TO service_role;
GRANT USAGE ON SEQUENCE public.platform_audit_log_id_seq TO service_role;

-- While an organization is being wiped, its rows are not written to the audit log one by one.
CREATE TABLE public.orgs_being_wiped (org_id uuid PRIMARY KEY);
ALTER TABLE public.orgs_being_wiped ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orgs_being_wiped FROM anon, authenticated;

-- Who made a change, in words, when it was not one of the organization's own team.
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS actor_label text;

-- ---------------------------------------------------------------------------
-- WHO IS WORKING WHERE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;

-- The signed-in super admin's current support session, if any.
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
  ORDER BY s.started_at DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.in_support_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (public.active_support_session()).id IS NOT NULL
$$;

-- The organization the signed-in user is working in: their support session's, else their own.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (public.active_support_session()).org_id,
    (SELECT org_id FROM public.profiles WHERE id = auth.uid()))
$$;

-- A super admin in a support session acts as an admin of that organization.
CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.in_support_session()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND org_id = public.current_org_id()
          AND role = 'admin')
$$;

-- "FinSeka support — Ada" while in a support session, else null.
CREATE OR REPLACE FUNCTION public.support_actor_label()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'FinSeka support — ' || coalesce(nullif(trim(p.full_name), ''), u.email, 'staff')
  FROM public.active_support_session() s
  LEFT JOIN public.profiles p ON p.id = s.admin_id
  LEFT JOIN auth.users u ON u.id = s.admin_id
  WHERE s.id IS NOT NULL
$$;

-- What the app needs to know about the signed-in user, in one call.
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
    'support', (SELECT jsonb_build_object('org_id', s.org_id, 'reason', s.reason,
                                          'started_at', s.started_at, 'expires_at', s.expires_at)
                FROM public.active_support_session() s WHERE s.id IS NOT NULL))
$$;

-- ---------------------------------------------------------------------------
-- HISTORY: support changes are labelled; a wipe does not log each deleted row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  _new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  _row jsonb := coalesce(_new, _old);
  _org_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND _old = _new THEN
    RETURN NULL;
  END IF;
  -- Ledger lines made by payments mirror the payment, which is already logged;
  -- ledger updates only mark a line as reversed, which the reversal insert records.
  IF TG_TABLE_NAME = 'ledger_entries'
     AND (TG_OP = 'UPDATE'
          OR _row ->> 'source_table' IN ('due_payments', 'contribution_payments', 'pledge_payments')) THEN
    RETURN NULL;
  END IF;

  _org_id := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (_row ->> 'id')::uuid
                  ELSE (_row ->> 'org_id')::uuid END;
  IF _org_id IS NULL OR EXISTS (SELECT 1 FROM public.orgs_being_wiped WHERE org_id = _org_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_log (org_id, actor_id, actor_label, table_name, row_id, action, old_row, new_row)
  VALUES (_org_id, auth.uid(), public.support_actor_label(), TG_TABLE_NAME, (_row ->> 'id')::uuid,
          lower(TG_OP), _old, _new);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_row() FROM anon, public, authenticated;

-- ---------------------------------------------------------------------------
-- TEAM CHANGES ARE NOT MADE FROM A SUPPORT SESSION
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
  IF public.in_support_session() THEN
    RAISE EXCEPTION 'Team changes cannot be made from a support session.';
  END IF;
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
  IF public.in_support_session() THEN
    RAISE EXCEPTION 'Team changes cannot be made from a support session.';
  END IF;
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

CREATE OR REPLACE FUNCTION public.account_deletion_blocker()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.in_support_session()
    THEN 'End the support session before deleting your account.'
    WHEN public.is_org_admin()
     AND NOT EXISTS (SELECT 1 FROM public.user_roles
                     WHERE org_id = public.current_org_id() AND role = 'admin' AND user_id <> auth.uid())
     AND EXISTS (SELECT 1 FROM public.profiles
                 WHERE org_id = public.current_org_id() AND id <> auth.uid())
    THEN 'You are the only admin. Make someone else an admin before deleting your account.'
  END
$$;

-- ---------------------------------------------------------------------------
-- SYSTEM ADMIN PAGE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.require_platform_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only FinSeka system admins can do this.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_platform_action(
  _action text, _org_id uuid, _reason text, _details jsonb DEFAULT NULL, _admin_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.platform_audit_log (admin_id, admin_email, action, org_id, org_name, reason, details)
  SELECT a.id, a.email, _action, _org_id, (SELECT name FROM public.organizations WHERE id = _org_id),
         _reason, _details
  FROM (SELECT coalesce(_admin_id, auth.uid()) AS id) x
  LEFT JOIN auth.users a ON a.id = x.id
$$;

-- Organizations with counts only, newest first. Optional search on name or admin email.
CREATE OR REPLACE FUNCTION public.admin_org_list(_search text DEFAULT NULL)
RETURNS TABLE (id uuid, name text, created_at timestamptz, members bigint, team bigint,
               admin_emails text, last_activity timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY
  WITH admins AS (
    SELECT r.org_id, string_agg(u.email, ', ' ORDER BY u.email) AS emails
    FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
    WHERE r.role = 'admin'
    GROUP BY r.org_id
  )
  SELECT o.id, o.name, o.created_at,
         (SELECT count(*) FROM public.members m WHERE m.org_id = o.id),
         (SELECT count(*) FROM public.profiles p WHERE p.org_id = o.id),
         a.emails,
         (SELECT max(l.at) FROM public.audit_log l WHERE l.org_id = o.id)
  FROM public.organizations o
  LEFT JOIN admins a ON a.org_id = o.id
  WHERE _search IS NULL OR trim(_search) = ''
     OR o.name ILIKE '%' || trim(_search) || '%'
     OR a.emails ILIKE '%' || trim(_search) || '%'
  ORDER BY o.created_at DESC
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_activity(_limit int DEFAULT 50)
RETURNS SETOF public.platform_audit_log
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN QUERY SELECT * FROM public.platform_audit_log ORDER BY at DESC, id DESC LIMIT least(_limit, 500);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_support_session(_org_id uuid, _reason text, _minutes int DEFAULT 60)
RETURNS public.support_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s public.support_sessions;
BEGIN
  PERFORM public.require_platform_admin();
  IF length(trim(coalesce(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Write a short reason for opening this organization.';
  END IF;
  IF _minutes NOT BETWEEN 5 AND 240 THEN
    RAISE EXCEPTION 'A support session lasts between 5 minutes and 4 hours.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id) THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;

  PERFORM public.end_support_session();

  INSERT INTO public.support_sessions (admin_id, org_id, reason, expires_at)
  VALUES (auth.uid(), _org_id, trim(_reason), now() + make_interval(mins => _minutes))
  RETURNING * INTO _s;

  PERFORM public.log_platform_action('support_start', _org_id, _s.reason,
                                     jsonb_build_object('expires_at', _s.expires_at));
  INSERT INTO public.audit_log (org_id, actor_id, actor_label, table_name, row_id, action, new_row)
  VALUES (_org_id, auth.uid(), public.support_actor_label(), 'support_access', _s.id, 'start',
          jsonb_build_object('reason', _s.reason, 'expires_at', _s.expires_at));
  RETURN _s;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_support_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s public.support_sessions := public.active_support_session();
  _label text := public.support_actor_label();
BEGIN
  IF _s.id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.support_sessions SET ended_at = now() WHERE id = _s.id;
  PERFORM public.log_platform_action('support_end', _s.org_id, _s.reason);
  INSERT INTO public.audit_log (org_id, actor_id, actor_label, table_name, row_id, action, new_row)
  VALUES (_s.org_id, auth.uid(), _label, 'support_access', _s.id, 'end',
          jsonb_build_object('reason', _s.reason));
END;
$$;

-- Every row an organization owns, as one JSON document. Logged; a wipe requires a recent one.
CREATE OR REPLACE FUNCTION public.admin_export_org(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _out jsonb;
BEGIN
  PERFORM public.require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id) THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', now(),
    'organization', (SELECT to_jsonb(o) FROM public.organizations o WHERE o.id = _org_id),
    'team', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'user_id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', u.email,
                 'role', r.role)), '[]')
             FROM public.profiles p
             LEFT JOIN auth.users u ON u.id = p.id
             LEFT JOIN public.user_roles r ON r.user_id = p.id AND r.org_id = _org_id
             WHERE p.org_id = _org_id),
    'branches', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.branches t WHERE t.org_id = _org_id),
    'members', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.members t WHERE t.org_id = _org_id),
    'dues', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.dues t WHERE t.org_id = _org_id),
    'due_rates', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.due_rates t WHERE t.org_id = _org_id),
    'due_members', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.due_members t WHERE t.org_id = _org_id),
    'due_payments', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.due_payments t WHERE t.org_id = _org_id),
    'contributions', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.contributions t WHERE t.org_id = _org_id),
    'contribution_members', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.contribution_members t WHERE t.org_id = _org_id),
    'contribution_payments', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.contribution_payments t WHERE t.org_id = _org_id),
    'contribution_expenses', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.contribution_expenses t WHERE t.org_id = _org_id),
    'pledge_drives', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.pledge_drives t WHERE t.org_id = _org_id),
    'pledges', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.pledges t WHERE t.org_id = _org_id),
    'pledge_payments', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.pledge_payments t WHERE t.org_id = _org_id),
    'ledger_entries', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.ledger_entries t WHERE t.org_id = _org_id),
    'fiscal_years', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.fiscal_years t WHERE t.org_id = _org_id),
    'history', (SELECT coalesce(jsonb_agg(t ORDER BY t.at), '[]') FROM public.audit_log t WHERE t.org_id = _org_id)
  ) INTO _out;

  PERFORM public.log_platform_action('export', _org_id, NULL);
  RETURN _out;
END;
$$;

-- ---------------------------------------------------------------------------
-- WIPE (server code only, after it has checked the caller is a super admin)
-- ---------------------------------------------------------------------------
-- Returns the logins to delete (everyone in the organization except system admins) and the
-- number of rows removed. The server then deletes those logins and the organization's logo files.
CREATE OR REPLACE FUNCTION public.wipe_organization(
  _org_id uuid, _confirm_name text, _reason text, _admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _users uuid[];
  _kept uuid[];
  _counts jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _admin_id) THEN
    RAISE EXCEPTION 'Only FinSeka system admins can do this.';
  END IF;
  SELECT name INTO _name FROM public.organizations WHERE id = _org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;
  IF trim(coalesce(_confirm_name, '')) <> trim(_name) THEN
    RAISE EXCEPTION 'The name typed does not match the organization''s name.';
  END IF;
  IF length(trim(coalesce(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Write a reason for wiping out this organization.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_audit_log
                 WHERE org_id = _org_id AND action = 'export' AND admin_id = _admin_id
                   AND at > now() - interval '30 minutes') THEN
    RAISE EXCEPTION 'Download a copy of this organization''s records first.';
  END IF;

  SELECT coalesce(array_agg(p.id) FILTER (WHERE a.user_id IS NULL), '{}'),
         coalesce(array_agg(p.id) FILTER (WHERE a.user_id IS NOT NULL), '{}')
  INTO _users, _kept
  FROM public.profiles p LEFT JOIN public.platform_admins a ON a.user_id = p.id
  WHERE p.org_id = _org_id;

  SELECT jsonb_build_object(
    'members', (SELECT count(*) FROM public.members WHERE org_id = _org_id),
    'due_payments', (SELECT count(*) FROM public.due_payments WHERE org_id = _org_id),
    'contribution_payments', (SELECT count(*) FROM public.contribution_payments WHERE org_id = _org_id),
    'pledges', (SELECT count(*) FROM public.pledges WHERE org_id = _org_id),
    'ledger_entries', (SELECT count(*) FROM public.ledger_entries WHERE org_id = _org_id),
    'history', (SELECT count(*) FROM public.audit_log WHERE org_id = _org_id)
  ) INTO _counts;

  -- Logged before the organization goes, so its name is still known.
  PERFORM public.log_platform_action('wipe', _org_id, trim(_reason),
    jsonb_build_object('counts', _counts, 'logins_to_delete', cardinality(_users),
                       'system_admins_detached', cardinality(_kept)),
    _admin_id);

  INSERT INTO public.orgs_being_wiped (org_id) VALUES (_org_id);
  UPDATE public.support_sessions SET ended_at = now() WHERE org_id = _org_id AND ended_at IS NULL;

  -- Ledger first (payments' delete triggers then find nothing to remove), then pledges, whose
  -- links to drives, contributions and pledge payments do not cascade. Everything else goes with
  -- the organization: its foreign keys cascade.
  DELETE FROM public.ledger_entries WHERE org_id = _org_id;
  DELETE FROM public.pledge_payments WHERE org_id = _org_id;
  DELETE FROM public.pledges WHERE org_id = _org_id;
  DELETE FROM public.pledge_drives WHERE org_id = _org_id;
  DELETE FROM public.organizations WHERE id = _org_id;
  DELETE FROM public.audit_log WHERE org_id = _org_id;

  -- System admins who were in it keep their login, without an organization.
  UPDATE public.profiles SET org_id = NULL, must_change_password = false WHERE id = ANY (_kept);

  DELETE FROM public.orgs_being_wiped WHERE org_id = _org_id;
  RETURN jsonb_build_object('name', _name, 'user_ids', to_jsonb(_users), 'counts', _counts);
END;
$$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM anon, public;
REVOKE ALL ON FUNCTION public.active_support_session() FROM anon, public;
REVOKE ALL ON FUNCTION public.in_support_session() FROM anon, public;
REVOKE ALL ON FUNCTION public.current_org_id() FROM anon, public;
REVOKE ALL ON FUNCTION public.is_org_admin() FROM anon, public;
REVOKE ALL ON FUNCTION public.support_actor_label() FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.app_context() FROM anon, public;
REVOKE ALL ON FUNCTION public.remove_team_member(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.set_member_role(uuid, public.app_role) FROM anon, public;
REVOKE ALL ON FUNCTION public.account_deletion_blocker() FROM anon, public;
REVOKE ALL ON FUNCTION public.require_platform_admin() FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.log_platform_action(text, uuid, text, jsonb, uuid) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.admin_org_list(text) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_activity(int) FROM anon, public;
REVOKE ALL ON FUNCTION public.start_support_session(uuid, text, int) FROM anon, public;
REVOKE ALL ON FUNCTION public.end_support_session() FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_export_org(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.wipe_organization(uuid, text, text, uuid) FROM anon, public, authenticated;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_support_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.in_support_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_team_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_blocker() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_org_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_support_session(uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_support_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_export_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_organization(uuid, text, text, uuid) TO service_role;
-- Server code records what happened to the logins after a wipe.
GRANT EXECUTE ON FUNCTION public.log_platform_action(text, uuid, text, jsonb, uuid) TO service_role;
