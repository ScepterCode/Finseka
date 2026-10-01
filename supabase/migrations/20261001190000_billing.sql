-- BILLING: a 30-day free trial, then Pro at ₦5,000 a month.
--
-- * org_billing: one row per organization: when its trial ends, how long it has paid for, and
--   whether FinSeka gave it a free plan. New organizations get 30 days from sign-up; those already
--   on FinSeka get 30 days from the day this migration runs.
-- * billing_payments: every payment (Flutterwave or recorded by a super admin), each counted once.
-- * When an organization has neither a trial, a paid month, a 3-day grace after its paid month,
--   nor a free plan, it is read-only: its team can still see everything, but the database refuses
--   any new or changed record (the app also hides downloading and printing).
--   FinSeka support and server code are not held back.

CREATE OR REPLACE FUNCTION public.pro_monthly_price()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 5000::numeric $$;

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------
CREATE TABLE public.org_billing (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  trial_ends_at timestamptz NOT NULL,
  paid_until timestamptz,
  free_plan boolean NOT NULL DEFAULT false,
  provider text CHECK (provider IN ('flutterwave', 'manual')),
  provider_email text,                 -- the payer's email at Flutterwave (renewals come by email)
  provider_subscription_id text,
  auto_renew_cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_billing_provider_email_idx ON public.org_billing (lower(provider_email))
  WHERE provider = 'flutterwave';
ALTER TABLE public.org_billing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_billing FROM anon, authenticated;
GRANT SELECT ON public.org_billing TO authenticated;
GRANT ALL ON public.org_billing TO service_role;
CREATE POLICY org_billing_select ON public.org_billing
  FOR SELECT TO authenticated USING (org_id = (SELECT public.current_org_id()));

CREATE TABLE public.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('flutterwave', 'manual')),
  provider_ref text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'NGN',
  months int NOT NULL CHECK (months BETWEEN 1 AND 24),
  paid_at timestamptz NOT NULL DEFAULT now(),
  covers_from timestamptz NOT NULL,
  covers_until timestamptz NOT NULL,
  recorded_by uuid,
  note text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);
CREATE INDEX billing_payments_org_idx ON public.billing_payments (org_id, paid_at DESC);
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_payments FROM anon, authenticated;
GRANT ALL ON public.billing_payments TO service_role;

-- Which organization started each online checkout (the first payment is matched by its tx_ref).
CREATE TABLE public.billing_checkouts (
  tx_ref text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_checkouts_org_idx ON public.billing_checkouts (org_id);
ALTER TABLE public.billing_checkouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_checkouts FROM anon, authenticated;
GRANT ALL ON public.billing_checkouts TO service_role;

-- Every organization gets a trial: new ones from sign-up, existing ones from today.
INSERT INTO public.org_billing (org_id, trial_ends_at)
SELECT id, now() + interval '30 days' FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.start_org_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.org_billing (org_id, trial_ends_at) VALUES (NEW.id, NEW.created_at + interval '30 days')
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.start_org_trial() FROM anon, public, authenticated;
CREATE TRIGGER organizations_start_trial AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.start_org_trial();

-- ---------------------------------------------------------------------------
-- WHERE AN ORGANIZATION STANDS
-- ---------------------------------------------------------------------------
-- status: free | active (paid) | trial | grace (paid month over, 3 days to pay) | read_only
CREATE OR REPLACE FUNCTION public.billing_state(_org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'status', s.status,
    'can_write', s.status <> 'read_only',
    'trial_ends_at', b.trial_ends_at,
    'paid_until', b.paid_until,
    'grace_ends_at', b.paid_until + interval '3 days',
    'free_plan', b.free_plan,
    'provider', b.provider,
    'auto_renew', b.provider = 'flutterwave' AND b.auto_renew_cancelled_at IS NULL,
    'price', public.pro_monthly_price())
  FROM public.org_billing b
  CROSS JOIN LATERAL (SELECT CASE
      WHEN b.free_plan THEN 'free'
      WHEN b.paid_until > now() THEN 'active'
      WHEN b.trial_ends_at > now() THEN 'trial'
      WHEN b.paid_until + interval '3 days' > now() THEN 'grace'
      ELSE 'read_only' END AS status) s
  WHERE b.org_id = _org_id
$$;

-- Can the organization record and change things? (No billing row yet: yes.)
CREATE OR REPLACE FUNCTION public.org_can_write(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    -- Never paid: paid_until is null, which must count as "not paid", not as unknown.
    (SELECT b.free_plan OR b.trial_ends_at > now()
            OR coalesce(b.paid_until + interval '3 days' > now(), false)
     FROM public.org_billing b WHERE b.org_id = _org_id),
    true)
$$;

-- Refuses app users' changes to a read-only organization's records. Server code (no signed-in
-- user), FinSeka support, and an organization being wiped are let through.
CREATE OR REPLACE FUNCTION public.refuse_when_read_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _org_id := OLD.org_id;
  ELSE
    _org_id := NEW.org_id;
  END IF;
  IF auth.uid() IS NULL
     OR public.org_can_write(_org_id)
     OR public.in_support_session()
     OR EXISTS (SELECT 1 FROM public.orgs_being_wiped WHERE org_id = _org_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Your FinSeka plan has ended. You can still see your records; upgrade to Pro to record or change anything.';
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_when_read_only() FROM anon, public, authenticated;

DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['branches', 'members', 'dues', 'due_rates', 'due_members', 'due_payments',
                            'contributions', 'contribution_members', 'contribution_payments',
                            'contribution_expenses', 'ledger_entries', 'fiscal_years',
                            'pledge_drives', 'pledges', 'pledge_payments'] LOOP
    EXECUTE format('CREATE TRIGGER a0_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.refuse_when_read_only()', _t);
  END LOOP;
END;
$$;

-- What the app needs about the signed-in user, now with their organization's plan.
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
    'billing', public.billing_state(public.current_org_id()),
    'support', (SELECT jsonb_build_object('org_id', s.org_id, 'reason', s.reason,
                                          'started_at', s.started_at, 'expires_at', s.expires_at)
                FROM public.active_support_session() s WHERE s.id IS NOT NULL))
$$;

-- The signed-in organization's payments, newest first.
CREATE OR REPLACE FUNCTION public.org_billing_payments()
RETURNS TABLE (id uuid, provider text, amount numeric, currency text, months int, paid_at timestamptz,
               covers_from timestamptz, covers_until timestamptz, note text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.provider, p.amount, p.currency, p.months, p.paid_at, p.covers_from, p.covers_until, p.note
  FROM public.billing_payments p
  WHERE p.org_id = public.current_org_id()
  ORDER BY p.paid_at DESC
  LIMIT 100
$$;

-- Admins of the organization itself (not support) manage its plan.
CREATE OR REPLACE FUNCTION public.can_manage_billing()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public.in_support_session()
     AND EXISTS (SELECT 1 FROM public.user_roles
                 WHERE user_id = auth.uid() AND org_id = public.current_org_id() AND role = 'admin')
$$;

-- ---------------------------------------------------------------------------
-- RECORDING PAYMENTS (server code, and super admins through the console)
-- ---------------------------------------------------------------------------
-- Adds paid months after whatever is already covered (a payment during the trial starts when the
-- trial ends). The same provider reference is never counted twice.
CREATE OR REPLACE FUNCTION public.record_subscription_payment(
  _org_id uuid, _provider text, _provider_ref text, _amount numeric, _currency text, _months int,
  _paid_at timestamptz DEFAULT now(), _raw jsonb DEFAULT NULL, _recorded_by uuid DEFAULT NULL,
  _note text DEFAULT NULL, _provider_email text DEFAULT NULL, _subscription_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _b public.org_billing;
  _from timestamptz;
  _until timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM public.billing_payments WHERE provider = _provider AND provider_ref = _provider_ref) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;
  SELECT * INTO _b FROM public.org_billing WHERE org_id = _org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;
  IF _months IS NULL OR _months < 1 OR _months > 24 THEN
    RAISE EXCEPTION 'A payment covers between 1 and 24 months.';
  END IF;
  IF _provider = 'flutterwave'
     AND (upper(coalesce(_currency, '')) <> 'NGN' OR _amount < public.pro_monthly_price() * _months) THEN
    RAISE EXCEPTION 'That payment does not cover % month(s) of Pro.', _months;
  END IF;

  _from := greatest(now(), coalesce(_b.paid_until, now()), _b.trial_ends_at);
  _until := _from + make_interval(months => _months);

  INSERT INTO public.billing_payments (org_id, provider, provider_ref, amount, currency, months, paid_at,
                                       covers_from, covers_until, recorded_by, note, raw)
  VALUES (_org_id, _provider, _provider_ref, _amount, upper(coalesce(_currency, 'NGN')), _months,
          coalesce(_paid_at, now()), _from, _until, _recorded_by, _note, _raw);

  UPDATE public.org_billing
  SET paid_until = _until,
      provider = _provider,
      provider_email = CASE WHEN _provider = 'flutterwave' THEN coalesce(_provider_email, provider_email) ELSE provider_email END,
      provider_subscription_id = coalesce(_subscription_id, provider_subscription_id),
      auto_renew_cancelled_at = CASE WHEN _provider = 'flutterwave' THEN NULL ELSE auto_renew_cancelled_at END,
      updated_at = now()
  WHERE org_id = _org_id;

  INSERT INTO public.audit_log (org_id, actor_id, actor_label, table_name, action, new_row)
  VALUES (_org_id, NULL, 'FinSeka', 'billing', 'payment',
          jsonb_build_object('amount', _amount, 'months', _months, 'covers_until', _until, 'provider', _provider));

  RETURN jsonb_build_object('duplicate', false, 'covers_from', _from, 'covers_until', _until);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_billing_checkout(_tx_ref text, _org_id uuid, _by uuid, _email text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.billing_checkouts (tx_ref, org_id, created_by, email) VALUES (_tx_ref, _org_id, _by, _email)
$$;

CREATE OR REPLACE FUNCTION public.org_for_checkout(_tx_ref text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.billing_checkouts WHERE tx_ref = _tx_ref
$$;

-- A Flutterwave renewal arrives with the payer's email: the organization last paid with it.
CREATE OR REPLACE FUNCTION public.org_for_payer_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.org_billing
  WHERE provider = 'flutterwave' AND lower(provider_email) = lower(trim(_email))
  ORDER BY paid_until DESC NULLS LAST
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.mark_auto_renew_cancelled(_org_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.org_billing SET auto_renew_cancelled_at = coalesce(auto_renew_cancelled_at, now()), updated_at = now()
  WHERE org_id = _org_id
$$;

-- ---------------------------------------------------------------------------
-- SUPER ADMIN TOOLS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_org_billing(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN jsonb_build_object(
    'state', public.billing_state(_org_id),
    'provider_email', (SELECT provider_email FROM public.org_billing WHERE org_id = _org_id),
    'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', p.id, 'provider', p.provider, 'provider_ref', p.provider_ref, 'amount', p.amount,
                   'months', p.months, 'paid_at', p.paid_at, 'covers_until', p.covers_until,
                   'note', p.note, 'recorded_by_email', u.email::text) ORDER BY p.paid_at DESC), '[]')
                 FROM public.billing_payments p LEFT JOIN auth.users u ON u.id = p.recorded_by
                 WHERE p.org_id = _org_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_extend_trial(_org_id uuid, _days int, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _until timestamptz;
BEGIN
  PERFORM public.require_platform_admin();
  IF _days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Extend a trial by 1 to 365 days.';
  END IF;
  IF length(trim(coalesce(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Write a short reason.';
  END IF;
  UPDATE public.org_billing SET trial_ends_at = greatest(trial_ends_at, now()) + make_interval(days => _days),
         updated_at = now()
  WHERE org_id = _org_id RETURNING trial_ends_at INTO _until;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;
  PERFORM public.log_platform_action('trial_extended', _org_id, trim(_reason),
    jsonb_build_object('days', _days, 'trial_ends_at', _until));
  INSERT INTO public.audit_log (org_id, actor_id, actor_label, table_name, action, new_row)
  VALUES (_org_id, NULL, 'FinSeka', 'billing', 'trial_extended', jsonb_build_object('days', _days, 'trial_ends_at', _until));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_payment(
  _org_id uuid, _months int, _amount numeric, _reference text, _note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
BEGIN
  PERFORM public.require_platform_admin();
  _result := public.record_subscription_payment(
    _org_id, 'manual', coalesce(nullif(trim(_reference), ''), 'manual-' || gen_random_uuid()::text),
    _amount, 'NGN', _months, now(), NULL, auth.uid(), nullif(trim(coalesce(_note, '')), ''));
  IF (_result ->> 'duplicate')::boolean THEN
    RAISE EXCEPTION 'A payment with that reference is already recorded.';
  END IF;
  PERFORM public.log_platform_action('payment_recorded', _org_id, nullif(trim(coalesce(_note, '')), ''),
    jsonb_build_object('amount', _amount, 'months', _months, 'reference', _reference,
                       'covers_until', _result ->> 'covers_until'));
  RETURN _result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_free_plan(_org_id uuid, _free boolean, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  IF length(trim(coalesce(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Write a short reason.';
  END IF;
  UPDATE public.org_billing SET free_plan = _free, updated_at = now() WHERE org_id = _org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;
  PERFORM public.log_platform_action(CASE WHEN _free THEN 'free_plan_given' ELSE 'free_plan_removed' END,
                                     _org_id, trim(_reason));
  INSERT INTO public.audit_log (org_id, actor_id, actor_label, table_name, action, new_row)
  VALUES (_org_id, NULL, 'FinSeka', 'billing', CASE WHEN _free THEN 'free_plan_given' ELSE 'free_plan_removed' END,
          '{}'::jsonb);
END;
$$;

-- The organization list and overview now show plans.
DROP FUNCTION IF EXISTS public.admin_orgs(text, text, int, int);
CREATE FUNCTION public.admin_orgs(
  _search text DEFAULT NULL, _sort text DEFAULT 'newest', _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS TABLE (id uuid, name text, created_at timestamptz, members bigint, team bigint,
               admin_emails text, last_activity timestamptz, billing_status text, total_count bigint)
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
    SELECT r.org_id, string_agg(u.email::text, ', ' ORDER BY u.email) AS emails
    FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
    WHERE r.role = 'admin'
    GROUP BY r.org_id
  ),
  org_rows AS (
    SELECT o.id, o.name, o.created_at,
           (SELECT count(*) FROM public.members m WHERE m.org_id = o.id) AS members,
           (SELECT count(*) FROM public.profiles p WHERE p.org_id = o.id) AS team,
           a.emails AS admin_emails,
           (SELECT max(l.at) FROM public.audit_log l WHERE l.org_id = o.id) AS last_activity,
           public.billing_state(o.id) ->> 'status' AS billing_status
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

CREATE OR REPLACE FUNCTION public.admin_billing_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_platform_admin();
  RETURN (
    SELECT jsonb_build_object(
      'trial', count(*) FILTER (WHERE s = 'trial'),
      'active', count(*) FILTER (WHERE s = 'active'),
      'grace', count(*) FILTER (WHERE s = 'grace'),
      'read_only', count(*) FILTER (WHERE s = 'read_only'),
      'free', count(*) FILTER (WHERE s = 'free'),
      'monthly_revenue', count(*) FILTER (WHERE s = 'active') * public.pro_monthly_price(),
      'paid_last_30d', (SELECT coalesce(sum(amount), 0) FROM public.billing_payments WHERE paid_at > now() - interval '30 days'))
    FROM (SELECT public.billing_state(o.id) ->> 'status' AS s FROM public.organizations o) x
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.billing_state(uuid) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.org_can_write(uuid) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.app_context() FROM anon, public;
REVOKE ALL ON FUNCTION public.org_billing_payments() FROM anon, public;
REVOKE ALL ON FUNCTION public.can_manage_billing() FROM anon, public;
REVOKE ALL ON FUNCTION public.record_subscription_payment(uuid, text, text, numeric, text, int, timestamptz, jsonb, uuid, text, text, text) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.create_billing_checkout(text, uuid, uuid, text) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.org_for_checkout(text) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.org_for_payer_email(text) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.mark_auto_renew_cancelled(uuid) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.admin_org_billing(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_extend_trial(uuid, int, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_record_payment(uuid, int, numeric, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_set_free_plan(uuid, boolean, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_orgs(text, text, int, int) FROM anon, public;
REVOKE ALL ON FUNCTION public.admin_billing_overview() FROM anon, public;

GRANT EXECUTE ON FUNCTION public.app_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_billing_payments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_billing() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_subscription_payment(uuid, text, text, numeric, text, int, timestamptz, jsonb, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_billing_checkout(text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_for_checkout(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_for_payer_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_auto_renew_cancelled(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_org_billing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_trial(uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_payment(uuid, int, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_free_plan(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_orgs(text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_billing_overview() TO authenticated;
