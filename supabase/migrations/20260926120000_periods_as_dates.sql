-- PERIODS AS DATES
-- The database now works out due periods itself, from real dates:
--   * members have a join date and dues a start date; nobody owes for periods before either
--   * a due's amount has a history, so a new amount applies from a chosen period onward
--   * late charges apply only once a period is more than the due's grace days overdue
--   * payments store the period's start date; the label is for display only
--   * weekly periods are ISO weeks (Monday to Sunday)
-- The old functions that took a list of periods from the app remain as thin wrappers so
-- the live site keeps working until the new app code is deployed.

-- ---------------------------------------------------------------------------
-- Today, and period arithmetic
-- ---------------------------------------------------------------------------
-- "Today" in Nigeria. Tests pin it with SET finseka.today; the app never sets it.
CREATE OR REPLACE FUNCTION public.org_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(current_setting('finseka.today', true), '')::date,
                  (now() AT TIME ZONE 'Africa/Lagos')::date)
$$;

CREATE OR REPLACE FUNCTION public.period_start_of(_freq public.due_frequency, _d date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _freq
    WHEN 'monthly' THEN date_trunc('month', _d)::date
    WHEN 'yearly'  THEN date_trunc('year', _d)::date
    WHEN 'weekly'  THEN date_trunc('week', _d)::date   -- ISO week: Monday
    WHEN 'daily'   THEN _d
    ELSE NULL                                           -- custom: one period for all time
  END
$$;

CREATE OR REPLACE FUNCTION public.period_end_of(_freq public.due_frequency, _start date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _freq
    WHEN 'monthly' THEN (_start + interval '1 month' - interval '1 day')::date
    WHEN 'yearly'  THEN (_start + interval '1 year' - interval '1 day')::date
    WHEN 'weekly'  THEN _start + 6
    WHEN 'daily'   THEN _start
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.period_label(_freq public.due_frequency, _start date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _freq
    WHEN 'monthly' THEN to_char(_start, 'Mon YYYY')
    WHEN 'yearly'  THEN to_char(_start, 'YYYY')
    WHEN 'weekly'  THEN 'Week ' || to_char(_start, 'FMIW') || ', ' || to_char(_start, 'IYYY')
    WHEN 'daily'   THEN to_char(_start, 'FMDD Mon YYYY')
    ELSE 'All time'
  END
$$;

-- Every period from the one containing _from to the one containing _to, oldest first.
CREATE OR REPLACE FUNCTION public.due_periods(_freq public.due_frequency, _from date, _to date)
RETURNS TABLE (period_start date, period_end date, label text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s::date, public.period_end_of(_freq, s::date), public.period_label(_freq, s::date)
  FROM generate_series(
    public.period_start_of(_freq, _from),
    public.period_start_of(_freq, _to),
    CASE _freq WHEN 'monthly' THEN interval '1 month' WHEN 'yearly' THEN interval '1 year'
               WHEN 'weekly' THEN interval '1 week' ELSE interval '1 day' END
  ) AS s
  WHERE _freq <> 'custom' AND _from <= _to
  UNION ALL
  SELECT _from, NULL::date, 'All time' WHERE _freq = 'custom'
$$;

-- Old payments stored only a label; turn it back into the period's start date.
CREATE OR REPLACE FUNCTION public._period_start_from_label(_freq public.due_frequency, _label text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _m text[];
  _jan1 date;
BEGIN
  IF _freq = 'monthly' THEN RETURN to_date(_label, 'Mon YYYY');
  ELSIF _freq = 'yearly' THEN RETURN to_date(_label, 'YYYY');
  ELSIF _freq = 'daily' THEN RETURN to_date(_label, 'DD Mon YYYY');
  ELSIF _freq = 'weekly' THEN
    -- Old labels counted Sunday-to-Saturday weeks from 1 January.
    _m := regexp_match(_label, '^Week (\d+), (\d{4})$');
    IF _m IS NULL THEN RETURN NULL; END IF;
    _jan1 := make_date(_m[2]::int, 1, 1);
    RETURN date_trunc('week', _jan1 - extract(dow FROM _jan1)::int + (_m[1]::int - 1) * 7 + 1)::date;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Join dates, start dates, amount history
-- ---------------------------------------------------------------------------
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS joined_on date;
UPDATE public.members SET joined_on = (created_at AT TIME ZONE 'Africa/Lagos')::date WHERE joined_on IS NULL;
ALTER TABLE public.members
  ALTER COLUMN joined_on SET DEFAULT ((now() AT TIME ZONE 'Africa/Lagos')::date),
  ALTER COLUMN joined_on SET NOT NULL;
GRANT UPDATE (joined_on) ON public.members TO authenticated;

ALTER TABLE public.dues ADD COLUMN IF NOT EXISTS starts_on date;
UPDATE public.dues SET starts_on = (created_at AT TIME ZONE 'Africa/Lagos')::date WHERE starts_on IS NULL;
ALTER TABLE public.dues
  ALTER COLUMN starts_on SET DEFAULT ((now() AT TIME ZONE 'Africa/Lagos')::date),
  ALTER COLUMN starts_on SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.due_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  due_id uuid NOT NULL REFERENCES public.dues(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  effective_from date NOT NULL,          -- start of the first period this amount applies to
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (due_id, effective_from)
);
ALTER TABLE public.due_rates ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.due_rates TO authenticated;
GRANT ALL ON public.due_rates TO service_role;
CREATE POLICY due_rates_select ON public.due_rates
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());

INSERT INTO public.due_rates (org_id, due_id, amount, effective_from)
SELECT org_id, id, amount, coalesce(public.period_start_of(frequency, starts_on), starts_on)
FROM public.dues
WHERE amount > 0
ON CONFLICT (due_id, effective_from) DO NOTHING;

-- Every new due starts with its first rate.
CREATE OR REPLACE FUNCTION public.seed_due_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.due_rates (org_id, due_id, amount, effective_from, created_by)
  VALUES (NEW.org_id, NEW.id, NEW.amount,
          coalesce(public.period_start_of(NEW.frequency, NEW.starts_on), NEW.starts_on), auth.uid())
  ON CONFLICT (due_id, effective_from) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS dues_seed_rate ON public.dues;
CREATE TRIGGER dues_seed_rate AFTER INSERT ON public.dues
  FOR EACH ROW EXECUTE FUNCTION public.seed_due_rate();

-- The amount due for a period: the latest rate that had started by then.
CREATE OR REPLACE FUNCTION public.due_amount_for(_due_id uuid, _period_start date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT amount FROM due_rates WHERE due_id = _due_id AND effective_from <= _period_start
     ORDER BY effective_from DESC LIMIT 1),
    (SELECT amount FROM due_rates WHERE due_id = _due_id ORDER BY effective_from LIMIT 1),
    (SELECT amount FROM dues WHERE id = _due_id)
  )
$$;

-- ---------------------------------------------------------------------------
-- Payments carry their period's start date
-- ---------------------------------------------------------------------------
ALTER TABLE public.due_payments ADD COLUMN IF NOT EXISTS period_start date;
UPDATE public.due_payments p
SET period_start = coalesce(
  CASE WHEN d.frequency = 'custom' THEN d.starts_on
       ELSE public._period_start_from_label(d.frequency, p.period_label) END,
  coalesce(public.period_start_of(d.frequency, p.paid_at), d.starts_on))
FROM public.dues d
WHERE d.id = p.due_id AND p.period_start IS NULL;
-- Relabel from the date (weekly labels become ISO weeks).
UPDATE public.due_payments p
SET period_label = public.period_label(d.frequency, p.period_start)
FROM public.dues d
WHERE d.id = p.due_id AND p.period_label IS DISTINCT FROM public.period_label(d.frequency, p.period_start);
ALTER TABLE public.due_payments ALTER COLUMN period_start SET NOT NULL;
CREATE INDEX IF NOT EXISTS due_payments_due_start_member_idx
  ON public.due_payments (due_id, period_start, member_id);

-- Whatever the app sends (a date, or only a label from the old app), store the
-- period's true start date and matching label.
CREATE OR REPLACE FUNCTION public.fill_due_payment_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _freq public.due_frequency;
  _starts date;
BEGIN
  SELECT frequency, starts_on INTO _freq, _starts FROM public.dues WHERE id = NEW.due_id;
  IF _freq = 'custom' THEN
    NEW.period_start := _starts;
  ELSE
    NEW.period_start := public.period_start_of(_freq, coalesce(
      NEW.period_start,
      public._period_start_from_label(_freq, NEW.period_label),
      NEW.paid_at));
  END IF;
  NEW.period_label := public.period_label(_freq, NEW.period_start);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS due_payments_fill_period ON public.due_payments;
CREATE TRIGGER due_payments_fill_period BEFORE INSERT ON public.due_payments
  FOR EACH ROW EXECUTE FUNCTION public.fill_due_payment_period();

-- Ledger descriptions compare against the rate for that period.
CREATE OR REPLACE FUNCTION public.sync_due_payment_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _due_name text;
  _due_amount numeric;
  _member_name text;
  _total numeric;
  _desc text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.ledger_entries WHERE source_table = 'due_payments' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  IF (TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO _due_name FROM public.dues WHERE id = NEW.due_id;
  _due_amount := public.due_amount_for(NEW.due_id, NEW.period_start);
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  SELECT coalesce(sum(amount), 0) + NEW.amount INTO _total
  FROM public.due_payments
  WHERE due_id = NEW.due_id AND member_id = NEW.member_id
    AND period_start = NEW.period_start AND id <> NEW.id AND voided_at IS NULL;

  _desc := coalesce(_member_name, 'Member') || ' paid ' || coalesce(_due_name, 'dues') || ' (' || NEW.period_label || ')';
  IF _due_amount IS NOT NULL AND _due_amount > 0 THEN
    IF _total < _due_amount THEN
      _desc := _desc || ' — part payment';
    ELSIF NEW.amount < _due_amount THEN
      _desc := _desc || ' — balance paid';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id, method)
    VALUES (NEW.org_id, 'income', 'Dues', _desc, NEW.amount, NEW.paid_at, 'due_payments', NEW.id, NEW.member_id, NEW.method);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount, entry_date = NEW.paid_at, description = _desc,
        member_id = NEW.member_id, method = NEW.method
    WHERE source_table = 'due_payments' AND source_id = NEW.id AND reversed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Who owes what (replaces the versions that took periods from the app)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.standing_lines(jsonb, uuid);
DROP FUNCTION IF EXISTS public.member_balances(jsonb, uuid);
DROP FUNCTION IF EXISTS public.dashboard_summary(jsonb);
DROP FUNCTION IF EXISTS public.report_summary(date, date, jsonb);

CREATE OR REPLACE FUNCTION public.standing_lines(_member_id uuid DEFAULT NULL)
RETURNS TABLE (
  kind text,
  member_id uuid,
  ref_id uuid,
  ref_name text,
  period_label text,
  is_current boolean,   -- the period containing today (dues) or still open (contributions)
  is_past boolean,      -- a due period that has ended
  expected numeric,
  paid numeric,
  short numeric,
  penalty numeric,
  period_start date,
  period_end date
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (SELECT org_today() AS today),
  m AS (
    SELECT id, joined_on FROM members
    WHERE org_id = current_org_id() AND ((_member_id IS NULL AND active) OR id = _member_id)
  ),
  d AS (
    SELECT id, name, frequency, penalty_amount, penalty_grace_days, starts_on
    FROM dues WHERE org_id = current_org_id() AND active
  ),
  p AS (
    SELECT d.id AS due_id, x.period_start, x.period_end, x.label,
           due_amount_for(d.id, x.period_start) AS expected
    FROM d, t, LATERAL due_periods(d.frequency, d.starts_on, t.today) x
  ),
  dp AS (
    SELECT due_id, member_id, period_start, sum(amount) AS paid
    FROM due_payments
    WHERE org_id = current_org_id() AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY due_id, member_id, period_start
  ),
  cp AS (
    SELECT contribution_id, member_id, sum(amount) AS paid
    FROM contribution_payments
    WHERE org_id = current_org_id() AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY contribution_id, member_id
  )
  SELECT
    'due', m.id, d.id, d.name, p.label,
    p.period_end IS NULL OR t.today BETWEEN p.period_start AND p.period_end,
    p.period_end IS NOT NULL AND p.period_end < t.today,
    p.expected,
    coalesce(dp.paid, 0),
    greatest(p.expected - coalesce(dp.paid, 0), 0),
    CASE WHEN p.period_end IS NOT NULL
          AND t.today > p.period_end + d.penalty_grace_days
          AND p.expected > coalesce(dp.paid, 0)
         THEN d.penalty_amount ELSE 0 END,
    p.period_start, p.period_end
  FROM d
  JOIN p ON p.due_id = d.id
  JOIN m ON p.period_end IS NULL OR p.period_end >= m.joined_on
  CROSS JOIN t
  LEFT JOIN dp ON dp.due_id = d.id AND dp.member_id = m.id AND dp.period_start = p.period_start
  UNION ALL
  SELECT
    'contribution', cm.member_id, c.id, c.name, NULL, NOT c.closed, false,
    c.amount_per_person, coalesce(cp.paid, 0),
    greatest(c.amount_per_person - coalesce(cp.paid, 0), 0), 0, NULL::date, NULL::date
  FROM contribution_members cm
  JOIN contributions c ON c.id = cm.contribution_id AND c.mandatory
  JOIN m ON m.id = cm.member_id
  LEFT JOIN cp ON cp.contribution_id = c.id AND cp.member_id = cm.member_id
  WHERE c.org_id = current_org_id()
$$;

CREATE OR REPLACE FUNCTION public.member_balances(_member_id uuid DEFAULT NULL)
RETURNS TABLE (
  member_id uuid,
  name text,
  dues_owing numeric,
  penalties numeric,
  contributions_owing numeric,
  total_owing numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.id, m.name,
    coalesce(sum(l.short) FILTER (WHERE l.kind = 'due'), 0),
    coalesce(sum(l.penalty), 0),
    coalesce(sum(l.short) FILTER (WHERE l.kind = 'contribution'), 0),
    coalesce(sum(l.short + l.penalty), 0)
  FROM members m
  LEFT JOIN standing_lines(_member_id) l ON l.member_id = m.id
  WHERE m.org_id = current_org_id()
    AND ((_member_id IS NULL AND m.active) OR m.id = _member_id)
  GROUP BY m.id, m.name
$$;

CREATE OR REPLACE FUNCTION public.dashboard_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH lines AS (SELECT * FROM standing_lines()),
  cur AS (SELECT * FROM lines WHERE kind = 'due' AND is_current)
  SELECT ledger_totals() || jsonb_build_object(
    'owed', (SELECT coalesce(sum(short + penalty), 0) FROM lines),
    'member_count', (SELECT count(*) FROM members WHERE org_id = current_org_id() AND active),
    'dues_paid', (SELECT count(*) FROM cur WHERE paid >= expected),
    'dues_unpaid', (SELECT count(*) FROM cur WHERE paid < expected),
    'contributions', contribution_progress(true),
    'recent', (
      SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.entry_date DESC, r.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT id, kind, label, description, amount, entry_date, created_at
        FROM ledger_entries WHERE org_id = current_org_id()
        ORDER BY entry_date DESC, created_at DESC LIMIT 6
      ) r
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.report_summary(_from date, _to date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ledger_totals(_from, _to) || jsonb_build_object(
    'by_label', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('label', label, 'income', income, 'expense', expense)
                                ORDER BY income DESC, expense DESC), '[]'::jsonb)
      FROM (
        SELECT label,
               coalesce(sum(amount) FILTER (WHERE kind = 'income'), 0) AS income,
               coalesce(sum(amount) FILTER (WHERE kind = 'expense'), 0) AS expense
        FROM ledger_entries
        WHERE org_id = current_org_id() AND entry_date BETWEEN _from AND _to
        GROUP BY label
      ) t
    ),
    'defaulters', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', member_id, 'name', name, 'owing', total_owing)
                                ORDER BY total_owing DESC, name), '[]'::jsonb)
      FROM member_balances() WHERE total_owing > 0
    ),
    'contributions', contribution_progress(false)
  )
$$;

-- Wrappers with the old signatures, so the live site keeps working until the new app
-- code is deployed. They ignore the periods the old app sends. Remove in a later migration.
CREATE OR REPLACE FUNCTION public.member_balances(_periods jsonb, _member_id uuid DEFAULT NULL)
RETURNS TABLE (member_id uuid, name text, dues_owing numeric, penalties numeric,
               contributions_owing numeric, total_owing numeric)
LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT * FROM member_balances(_member_id) $$;

CREATE OR REPLACE FUNCTION public.standing_lines(_periods jsonb, _member_id uuid DEFAULT NULL)
RETURNS TABLE (kind text, member_id uuid, ref_id uuid, ref_name text, period_label text,
               is_current boolean, is_past boolean, expected numeric, paid numeric,
               short numeric, penalty numeric)
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT kind, member_id, ref_id, ref_name, period_label, is_current, is_past,
         expected, paid, short, penalty
  FROM standing_lines(_member_id)
$$;

CREATE OR REPLACE FUNCTION public.dashboard_summary(_periods jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT dashboard_summary() $$;

CREATE OR REPLACE FUNCTION public.report_summary(_from date, _to date, _periods jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT report_summary(_from, _to) $$;

-- ---------------------------------------------------------------------------
-- For the dues page: every period of a due, newest first, with its amount
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.due_period_list(_due_id uuid)
RETURNS TABLE (period_start date, period_end date, label text, is_current boolean,
               is_past boolean, expected numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT x.period_start, x.period_end, x.label,
         x.period_end IS NULL OR org_today() BETWEEN x.period_start AND x.period_end,
         x.period_end IS NOT NULL AND x.period_end < org_today(),
         due_amount_for(d.id, x.period_start)
  FROM dues d, LATERAL due_periods(d.frequency, d.starts_on, org_today()) x
  WHERE d.id = _due_id AND d.org_id = current_org_id()
  ORDER BY x.period_start DESC
$$;

-- ---------------------------------------------------------------------------
-- Changing a due's amount from a chosen period onward
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_due_amount(_due_id uuid, _amount numeric, _from date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  d public.dues;
  _effective date;
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'A due must be more than ₦0.';
  END IF;
  SELECT * INTO d FROM public.dues WHERE id = _due_id AND org_id = _org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Due not found.';
  END IF;

  _effective := coalesce(public.period_start_of(d.frequency, _from), d.starts_on);
  IF _effective < coalesce(public.period_start_of(d.frequency, d.starts_on), d.starts_on) THEN
    _effective := coalesce(public.period_start_of(d.frequency, d.starts_on), d.starts_on);
  END IF;

  INSERT INTO public.due_rates (org_id, due_id, amount, effective_from, created_by)
  VALUES (_org_id, _due_id, _amount, _effective, auth.uid())
  ON CONFLICT (due_id, effective_from) DO UPDATE SET amount = EXCLUDED.amount, created_by = EXCLUDED.created_by;

  -- dues.amount shows the amount that applies today.
  UPDATE public.dues SET amount = public.due_amount_for(_due_id, public.org_today()) WHERE id = _due_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Opening balance: cash and bank on the day the organization starts using FinSeka
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_opening_balance(_cash numeric, _bank numeric, _as_of date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _day date := coalesce(_as_of, public.org_today());
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF coalesce(_cash, 0) < 0 OR coalesce(_bank, 0) < 0 THEN
    RAISE EXCEPTION 'Opening amounts cannot be less than ₦0.';
  END IF;
  IF (SELECT opening_balance_set FROM public.organizations WHERE id = _org_id) THEN
    RAISE EXCEPTION 'The opening balance has already been set. To correct it, reverse the opening line in the ledger and add the right amount.';
  END IF;

  IF coalesce(_cash, 0) > 0 THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, method, source_table)
    VALUES (_org_id, 'income', 'Opening balance', 'Cash in hand when we started using FinSeka', _cash, _day, 'cash', 'opening_balance');
  END IF;
  IF coalesce(_bank, 0) > 0 THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, method, source_table)
    VALUES (_org_id, 'income', 'Opening balance', 'Money in the bank when we started using FinSeka', _bank, _day, 'transfer', 'opening_balance');
  END IF;

  UPDATE public.organizations SET opening_balance_set = true WHERE id = _org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- History covers the new amount table too
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_due_rates ON public.due_rates;
CREATE TRIGGER audit_due_rates AFTER INSERT OR UPDATE OR DELETE ON public.due_rates
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._period_start_from_label(public.due_frequency, text) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.seed_due_rate() FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.fill_due_payment_period() FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.change_due_amount(uuid, numeric, date) FROM anon, public;
REVOKE ALL ON FUNCTION public.set_opening_balance(numeric, numeric, date) FROM anon, public;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.org_today()',
    'public.period_start_of(public.due_frequency, date)',
    'public.period_end_of(public.due_frequency, date)',
    'public.period_label(public.due_frequency, date)',
    'public.due_periods(public.due_frequency, date, date)',
    'public.due_amount_for(uuid, date)',
    'public.standing_lines(uuid)',
    'public.member_balances(uuid)',
    'public.dashboard_summary()',
    'public.report_summary(date, date)',
    'public.standing_lines(jsonb, uuid)',
    'public.member_balances(jsonb, uuid)',
    'public.dashboard_summary(jsonb)',
    'public.report_summary(date, date, jsonb)',
    'public.due_period_list(uuid)',
    'public.change_due_amount(uuid, numeric, date)',
    'public.set_opening_balance(numeric, numeric, date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, public', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END;
$$;
