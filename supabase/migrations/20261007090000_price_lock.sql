-- Launch price lock: an organization that goes Pro while the launch price (₦5,000) is below the
-- standard price (₦7,000) keeps the launch price for its first 12 months of Pro, counted from the
-- start of its first paid month. After that it pays whatever Pro costs then.
--
-- pro_monthly_price() is what Pro costs a new customer today; pro_standard_price() is the price after
-- the launch. While the first is lower, the launch offer is on.

CREATE OR REPLACE FUNCTION public.pro_standard_price()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 7000::numeric $$;

ALTER TABLE public.org_billing
  ADD COLUMN IF NOT EXISTS locked_price numeric CHECK (locked_price > 0),
  ADD COLUMN IF NOT EXISTS price_locked_until timestamptz;

-- What each online checkout must be paid (worked out when it starts, so a price change or the lock
-- ending while someone is paying does not refuse their payment).
ALTER TABLE public.billing_checkouts ADD COLUMN IF NOT EXISTS amount numeric CHECK (amount > 0);
UPDATE public.billing_checkouts SET amount = months * public.pro_monthly_price() WHERE amount IS NULL;

-- Organizations that have already paid keep the launch price for 12 months from their first paid month.
UPDATE public.org_billing b
SET locked_price = public.pro_monthly_price(),
    price_locked_until = f.first_from + interval '12 months'
FROM (SELECT org_id, min(covers_from) AS first_from FROM public.billing_payments GROUP BY org_id) f
WHERE b.org_id = f.org_id
  AND b.price_locked_until IS NULL
  AND public.pro_monthly_price() < public.pro_standard_price();

-- What _months more months of Pro cost this organization, month by month: the locked price for
-- months that start before the lock ends, today's price after. An organization that has never paid
-- would lock today's launch price from its first paid month, so its quote counts that way too.
CREATE OR REPLACE FUNCTION public.pro_quote(_org_id uuid, _months int)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT s.from_at,
           coalesce(ob.price_locked_until,
                    CASE WHEN public.pro_monthly_price() < public.pro_standard_price()
                         THEN s.from_at + interval '12 months' END) AS lock_until,
           coalesce(ob.locked_price, public.pro_monthly_price()) AS lock_price
    FROM public.org_billing ob
    CROSS JOIN LATERAL (SELECT greatest(now(), coalesce(ob.paid_until, now()), ob.trial_ends_at) AS from_at) s
    WHERE ob.org_id = _org_id)
  SELECT sum(CASE WHEN b.lock_until IS NOT NULL AND b.from_at + make_interval(months => i) < b.lock_until
                  THEN b.lock_price ELSE public.pro_monthly_price() END)
  FROM b CROSS JOIN generate_series(0, _months - 1) i
$$;

-- The app's month picker: what 1 to 12 months cost the signed-in organization.
CREATE OR REPLACE FUNCTION public.my_pro_quotes()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_agg(public.pro_quote((SELECT public.current_org_id()), n) ORDER BY n)
  FROM generate_series(1, 12) n
$$;

-- Same as before, plus the prices: this organization's next month, the standard price, and its lock.
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
    'price', coalesce(public.pro_quote(b.org_id, 1), public.pro_monthly_price()),
    'standard_price', public.pro_standard_price(),
    'locked_price', b.locked_price,
    'price_locked_until', b.price_locked_until)
  FROM public.org_billing b
  CROSS JOIN LATERAL (SELECT CASE
      WHEN b.free_plan THEN 'free'
      WHEN b.paid_until > now() THEN 'active'
      WHEN b.trial_ends_at > now() THEN 'trial'
      WHEN b.paid_until + interval '3 days' > now() THEN 'grace'
      ELSE 'read_only' END AS status) s
  WHERE b.org_id = _org_id
$$;

-- Same as before, except that the first payment locks the launch price (while the offer is on), and
-- Bachs amounts are checked against their checkout by record_bachs_payment instead.
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
  _lock boolean;
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
  _lock := _b.price_locked_until IS NULL AND public.pro_monthly_price() < public.pro_standard_price();

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
      locked_price = CASE WHEN _lock THEN public.pro_monthly_price() ELSE locked_price END,
      price_locked_until = CASE WHEN _lock THEN _from + interval '12 months' ELSE price_locked_until END,
      updated_at = now()
  WHERE org_id = _org_id;

  INSERT INTO public.audit_log (org_id, actor_id, actor_label, table_name, action, new_row)
  VALUES (_org_id, NULL, 'FinSeka', 'billing', 'payment',
          jsonb_build_object('amount', _amount, 'months', _months, 'covers_until', _until, 'provider', _provider));

  RETURN jsonb_build_object('duplicate', false, 'covers_from', _from, 'covers_until', _until);
END;
$$;

-- Starts a Bachs checkout: stores what it must be paid, and returns that amount.
CREATE OR REPLACE FUNCTION public.start_bachs_checkout(
  _reference text, _org_id uuid, _by uuid, _email text, _months int)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _amount numeric := public.pro_quote(_org_id, _months);
BEGIN
  IF _amount IS NULL THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;
  INSERT INTO public.billing_checkouts (tx_ref, org_id, created_by, email, months, amount)
  VALUES (_reference, _org_id, _by, _email, _months, _amount);
  RETURN _amount;
END;
$$;

-- The organization, months and amount behind a checkout reference (null if unknown).
CREATE OR REPLACE FUNCTION public.billing_checkout(_reference text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('org_id', org_id, 'months', months,
                            'amount', coalesce(amount, months * public.pro_monthly_price()))
  FROM public.billing_checkouts WHERE tx_ref = _reference
$$;

-- Records a paid Bachs checkout, if it was paid in naira and at least what the checkout asked for.
CREATE OR REPLACE FUNCTION public.record_bachs_payment(
  _reference text, _checkout_id text, _amount numeric, _currency text, _paid_at timestamptz, _raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c public.billing_checkouts;
BEGIN
  SELECT * INTO _c FROM public.billing_checkouts WHERE tx_ref = _reference;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown checkout.';
  END IF;
  IF upper(coalesce(_currency, '')) <> 'NGN'
     OR _amount < coalesce(_c.amount, _c.months * public.pro_monthly_price()) THEN
    RAISE EXCEPTION 'That payment does not cover % month(s) of Pro.', _c.months;
  END IF;
  RETURN public.record_subscription_payment(_c.org_id, 'bachs', _checkout_id, _amount, 'NGN', _c.months,
                                            coalesce(_paid_at, now()), _raw);
END;
$$;

REVOKE ALL ON FUNCTION public.pro_quote(uuid, int) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.my_pro_quotes() FROM anon, public;
REVOKE ALL ON FUNCTION public.start_bachs_checkout(text, uuid, uuid, text, int) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.record_bachs_payment(text, text, numeric, text, timestamptz, jsonb) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_quote(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_pro_quotes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_bachs_checkout(text, uuid, uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_bachs_payment(text, text, numeric, text, timestamptz, jsonb) TO service_role;
