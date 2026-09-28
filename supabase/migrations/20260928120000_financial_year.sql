-- FINANCIAL YEAR
-- Each organization picks the month its financial year starts. A year-end statement
-- shows opening money, income and spending by category, and closing money. Once a year
-- has ended, an admin can close it: its figures are saved and nothing dated inside it can
-- be added or changed any more (corrections go into the current year, dated today).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month int NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12);
GRANT UPDATE (fiscal_year_start_month) ON public.organizations TO authenticated;

CREATE TABLE IF NOT EXISTS public.fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  opening_cash numeric(14,2) NOT NULL,
  opening_bank numeric(14,2) NOT NULL,
  income numeric(14,2) NOT NULL,
  expense numeric(14,2) NOT NULL,
  closing_cash numeric(14,2) NOT NULL,
  closing_bank numeric(14,2) NOT NULL,
  owed_at_close numeric(14,2) NOT NULL,
  notes text,
  UNIQUE (org_id, starts_on),
  CHECK (ends_on > starts_on)
);
ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.fiscal_years TO authenticated;
GRANT ALL ON public.fiscal_years TO service_role;
CREATE POLICY fiscal_years_select ON public.fiscal_years
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
DROP TRIGGER IF EXISTS audit_fiscal_years ON public.fiscal_years;
CREATE TRIGGER audit_fiscal_years AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_years
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- The financial year that contains a date, for the signed-in user's organization.
CREATE OR REPLACE FUNCTION public.financial_year_of(_d date)
RETURNS TABLE (starts_on date, ends_on date, label text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH o AS (SELECT fiscal_year_start_month AS m FROM organizations WHERE id = current_org_id()),
  s AS (
    SELECT make_date(
             CASE WHEN extract(month FROM _d) >= o.m THEN extract(year FROM _d)::int
                  ELSE extract(year FROM _d)::int - 1 END,
             o.m, 1) AS start, o.m
    FROM o
  )
  SELECT start, (start + interval '1 year' - interval '1 day')::date,
         CASE WHEN m = 1 THEN 'FY ' || extract(year FROM start)::int
              ELSE 'FY ' || extract(year FROM start)::int || '/' || to_char(start + interval '1 year', 'YY') END
  FROM s
$$;

-- Everything the year-end statement shows. Uses the saved figures once a year is closed.
CREATE OR REPLACE FUNCTION public.financial_year_summary(_any_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH y AS (SELECT * FROM financial_year_of(coalesce(_any_date, org_today()))),
  before AS (SELECT ledger_totals(NULL, (SELECT starts_on - 1 FROM y)) AS t),
  during AS (SELECT ledger_totals((SELECT starts_on FROM y), (SELECT ends_on FROM y)) AS t),
  upto AS (SELECT ledger_totals(NULL, (SELECT ends_on FROM y)) AS t),
  closed AS (SELECT f.* FROM fiscal_years f, y WHERE f.org_id = current_org_id() AND f.starts_on = y.starts_on)
  SELECT jsonb_build_object(
    'starts_on', y.starts_on,
    'ends_on', y.ends_on,
    'label', y.label,
    'has_ended', y.ends_on < org_today(),
    'closed', EXISTS (SELECT 1 FROM closed),
    'closed_at', (SELECT closed_at FROM closed),
    'closed_by', (SELECT closed_by FROM closed),
    'notes', (SELECT notes FROM closed),
    'opening_cash', coalesce((SELECT opening_cash FROM closed), (SELECT (t ->> 'cash')::numeric FROM before)),
    'opening_bank', coalesce((SELECT opening_bank FROM closed), (SELECT (t ->> 'bank')::numeric FROM before)),
    'income', coalesce((SELECT income FROM closed), (SELECT (t ->> 'income')::numeric FROM during)),
    'expense', coalesce((SELECT expense FROM closed), (SELECT (t ->> 'expense')::numeric FROM during)),
    'closing_cash', coalesce((SELECT closing_cash FROM closed), (SELECT (t ->> 'cash')::numeric FROM upto)),
    'closing_bank', coalesce((SELECT closing_bank FROM closed), (SELECT (t ->> 'bank')::numeric FROM upto)),
    'owed', coalesce((SELECT owed_at_close FROM closed),
                     (SELECT coalesce(sum(short + penalty), 0) FROM standing_lines())),
    'by_label', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('label', label, 'income', income, 'expense', expense)
                                ORDER BY income DESC, expense DESC), '[]'::jsonb)
      FROM (
        SELECT label,
               coalesce(sum(amount) FILTER (WHERE kind = 'income'), 0) AS income,
               coalesce(sum(amount) FILTER (WHERE kind = 'expense'), 0) AS expense
        FROM ledger_entries
        WHERE org_id = current_org_id() AND entry_date BETWEEN y.starts_on AND y.ends_on
        GROUP BY label
      ) t
    )
  )
  FROM y
$$;

-- Close a year that has ended: save its figures and lock its dates.
CREATE OR REPLACE FUNCTION public.close_financial_year(_any_date date, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := current_org_id();
  s jsonb;
BEGIN
  IF _org_id IS NULL OR NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  s := financial_year_summary(_any_date);
  IF NOT (s ->> 'has_ended')::boolean THEN
    RAISE EXCEPTION '% has not ended yet (it ends on %).', s ->> 'label', s ->> 'ends_on';
  END IF;
  IF (s ->> 'closed')::boolean THEN
    RAISE EXCEPTION '% is already closed.', s ->> 'label';
  END IF;

  INSERT INTO fiscal_years (org_id, starts_on, ends_on, closed_by, opening_cash, opening_bank,
                            income, expense, closing_cash, closing_bank, owed_at_close, notes)
  VALUES (_org_id, (s ->> 'starts_on')::date, (s ->> 'ends_on')::date, auth.uid(),
          (s ->> 'opening_cash')::numeric, (s ->> 'opening_bank')::numeric,
          (s ->> 'income')::numeric, (s ->> 'expense')::numeric,
          (s ->> 'closing_cash')::numeric, (s ->> 'closing_bank')::numeric,
          (s ->> 'owed')::numeric, nullif(trim(coalesce(_notes, '')), ''));
END;
$$;

-- ---------------------------------------------------------------------------
-- Nothing dated inside a closed year can be added or changed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refuse_closed_year()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_date date;
  _old_date date;
  _year record;
BEGIN
  _new_date := (to_jsonb(NEW) ->> TG_ARGV[0])::date;
  IF TG_OP = 'UPDATE' THEN
    _old_date := (to_jsonb(OLD) ->> TG_ARGV[0])::date;
    -- Cancelling a payment or marking a line reversed only touches those fields: allowed.
    IF _new_date IS NOT DISTINCT FROM _old_date
       AND (to_jsonb(NEW) -> 'amount') IS NOT DISTINCT FROM (to_jsonb(OLD) -> 'amount') THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT starts_on, ends_on INTO _year FROM fiscal_years
  WHERE org_id = NEW.org_id AND (_new_date BETWEEN starts_on AND ends_on
                                 OR _old_date BETWEEN starts_on AND ends_on)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'That date is in a closed financial year (% to %). Use a date in the current year.',
      to_char(_year.starts_on, 'FMDD Mon YYYY'), to_char(_year.ends_on, 'FMDD Mon YYYY');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS closed_year_ledger ON public.ledger_entries;
CREATE TRIGGER closed_year_ledger BEFORE INSERT OR UPDATE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.refuse_closed_year('entry_date');
DROP TRIGGER IF EXISTS closed_year_due_payments ON public.due_payments;
CREATE TRIGGER closed_year_due_payments BEFORE INSERT OR UPDATE ON public.due_payments
  FOR EACH ROW EXECUTE FUNCTION public.refuse_closed_year('paid_at');
DROP TRIGGER IF EXISTS closed_year_contribution_payments ON public.contribution_payments;
CREATE TRIGGER closed_year_contribution_payments BEFORE INSERT OR UPDATE ON public.contribution_payments
  FOR EACH ROW EXECUTE FUNCTION public.refuse_closed_year('paid_at');
DROP TRIGGER IF EXISTS closed_year_contribution_expenses ON public.contribution_expenses;
CREATE TRIGGER closed_year_contribution_expenses BEFORE INSERT OR UPDATE ON public.contribution_expenses
  FOR EACH ROW EXECUTE FUNCTION public.refuse_closed_year('spent_at');

-- The start month cannot move once a year is closed (it would shift closed dates).
CREATE OR REPLACE FUNCTION public.refuse_start_month_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.fiscal_year_start_month IS DISTINCT FROM OLD.fiscal_year_start_month
     AND EXISTS (SELECT 1 FROM fiscal_years WHERE org_id = NEW.id) THEN
    RAISE EXCEPTION 'The financial year start cannot change after a year has been closed.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS organizations_start_month ON public.organizations;
CREATE TRIGGER organizations_start_month BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.refuse_start_month_change();

REVOKE ALL ON FUNCTION public.refuse_closed_year() FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.refuse_start_month_change() FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.financial_year_of(date) FROM anon, public;
REVOKE ALL ON FUNCTION public.financial_year_summary(date) FROM anon, public;
REVOKE ALL ON FUNCTION public.close_financial_year(date, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.financial_year_of(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.financial_year_summary(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_financial_year(date, text) TO authenticated;
