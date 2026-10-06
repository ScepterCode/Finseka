-- Online payment through Bachs (bachs.io): the admin pays for 1 to 12 months of Pro at once, in
-- naira, by bank transfer or card. There is no automatic renewal (Bachs does not bill naira
-- subscriptions yet). Flutterwave and manual payments keep working as before.

-- Payments can now come from Bachs.
ALTER TABLE public.org_billing DROP CONSTRAINT IF EXISTS org_billing_provider_check;
ALTER TABLE public.org_billing
  ADD CONSTRAINT org_billing_provider_check CHECK (provider IN ('flutterwave', 'bachs', 'manual'));
ALTER TABLE public.billing_payments DROP CONSTRAINT IF EXISTS billing_payments_provider_check;
ALTER TABLE public.billing_payments
  ADD CONSTRAINT billing_payments_provider_check CHECK (provider IN ('flutterwave', 'bachs', 'manual'));

-- How many months each checkout pays for (older Flutterwave checkouts are one month).
ALTER TABLE public.billing_checkouts
  ADD COLUMN IF NOT EXISTS months int NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 12);

CREATE OR REPLACE FUNCTION public.create_bachs_checkout(
  _reference text, _org_id uuid, _by uuid, _email text, _months int)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.billing_checkouts (tx_ref, org_id, created_by, email, months)
  VALUES (_reference, _org_id, _by, _email, _months)
$$;

-- The organization and number of months behind a checkout reference (null if unknown).
CREATE OR REPLACE FUNCTION public.billing_checkout(_reference text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('org_id', org_id, 'months', months)
  FROM public.billing_checkouts WHERE tx_ref = _reference
$$;

-- Same as before, except that a Bachs payment must also be in naira and cover every month it buys.
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
  IF _provider IN ('flutterwave', 'bachs')
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

REVOKE ALL ON FUNCTION public.create_bachs_checkout(text, uuid, uuid, text, int) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.billing_checkout(text) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bachs_checkout(text, uuid, uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_checkout(text) TO service_role;
