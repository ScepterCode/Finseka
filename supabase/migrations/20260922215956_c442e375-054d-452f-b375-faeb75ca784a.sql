
CREATE TYPE public.payment_method AS ENUM ('cash', 'transfer');

ALTER TABLE public.organizations ADD COLUMN opening_balance_set boolean NOT NULL DEFAULT false;

ALTER TABLE public.ledger_entries ADD COLUMN method public.payment_method NOT NULL DEFAULT 'cash';
ALTER TABLE public.due_payments ADD COLUMN method public.payment_method NOT NULL DEFAULT 'cash';
ALTER TABLE public.contribution_payments ADD COLUMN method public.payment_method NOT NULL DEFAULT 'cash';

ALTER TABLE public.dues ADD COLUMN penalty_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.dues ADD COLUMN penalty_grace_days integer NOT NULL DEFAULT 0;

ALTER TABLE public.members ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

CREATE TABLE public.contribution_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contribution_id uuid NOT NULL REFERENCES public.contributions(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  method public.payment_method NOT NULL DEFAULT 'cash',
  spent_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contribution_expenses TO authenticated;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
GRANT ALL ON public.contribution_expenses TO service_role;

ALTER TABLE public.contribution_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY contribution_expenses_select ON public.contribution_expenses
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY contribution_expenses_write ON public.contribution_expenses
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE TRIGGER update_contribution_expenses_updated_at
  BEFORE UPDATE ON public.contribution_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
  _desc text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.ledger_entries WHERE source_table = 'due_payments' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT name, amount INTO _due_name, _due_amount FROM public.dues WHERE id = NEW.due_id;
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  _desc := coalesce(_member_name, 'Member') || ' paid ' || coalesce(_due_name, 'dues') || ' (' || NEW.period_label || ')';
  IF _due_amount IS NOT NULL AND NEW.amount < _due_amount THEN
    _desc := _desc || ' — part payment';
  END IF;

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id, method)
    VALUES (NEW.org_id, 'income', 'Dues', _desc, NEW.amount, NEW.paid_at, 'due_payments', NEW.id, NEW.member_id, NEW.method);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount,
        entry_date = NEW.paid_at,
        description = _desc,
        member_id = NEW.member_id,
        method = NEW.method
    WHERE source_table = 'due_payments' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_contribution_payment_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c_name text;
  _c_amount numeric;
  _member_name text;
  _desc text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.ledger_entries WHERE source_table = 'contribution_payments' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT name, amount_per_person INTO _c_name, _c_amount FROM public.contributions WHERE id = NEW.contribution_id;
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  _desc := coalesce(_member_name, 'Member') || ' paid for ' || coalesce(_c_name, 'contribution');
  IF _c_amount IS NOT NULL AND _c_amount > 0 AND NEW.amount < _c_amount THEN
    _desc := _desc || ' — part payment';
  END IF;

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id, method)
    VALUES (NEW.org_id, 'income', 'Contribution', _desc, NEW.amount, NEW.paid_at, 'contribution_payments', NEW.id, NEW.member_id, NEW.method);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount,
        entry_date = NEW.paid_at,
        description = _desc,
        member_id = NEW.member_id,
        method = NEW.method
    WHERE source_table = 'contribution_payments' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
