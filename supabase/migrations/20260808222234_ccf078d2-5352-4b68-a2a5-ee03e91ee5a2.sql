ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.members(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

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
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id)
    VALUES (NEW.org_id, 'income', 'Dues', _desc, NEW.amount, NEW.paid_at, 'due_payments', NEW.id, NEW.member_id);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount,
        entry_date = NEW.paid_at,
        description = _desc,
        member_id = NEW.member_id
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
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id)
    VALUES (NEW.org_id, 'income', 'Contribution', _desc, NEW.amount, NEW.paid_at, 'contribution_payments', NEW.id, NEW.member_id);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount,
        entry_date = NEW.paid_at,
        description = _desc,
        member_id = NEW.member_id
    WHERE source_table = 'contribution_payments' AND source_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.ledger_entries le
SET member_id = dp.member_id
FROM public.due_payments dp
WHERE le.source_table = 'due_payments' AND le.source_id = dp.id AND le.member_id IS NULL;

UPDATE public.ledger_entries le
SET member_id = cp.member_id
FROM public.contribution_payments cp
WHERE le.source_table = 'contribution_payments' AND le.source_id = cp.id AND le.member_id IS NULL;

CREATE POLICY "admins_manage_roles_in_org" ON public.user_roles
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY "admins_update_profiles_in_org" ON public.profiles
  FOR UPDATE TO authenticated
  USING (org_id IS NOT NULL AND org_id = public.current_org_id() AND public.is_org_admin());