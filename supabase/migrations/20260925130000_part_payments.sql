-- PART PAYMENTS
-- A member can now pay a due period or a contribution in several instalments.
-- Paid / part paid / not paid is worked out from the sum of their payments.

ALTER TABLE public.due_payments
  DROP CONSTRAINT IF EXISTS due_payments_due_id_member_id_period_label_key;
ALTER TABLE public.contribution_payments
  DROP CONSTRAINT IF EXISTS contribution_payments_contribution_id_member_id_key;

-- The dropped unique keys doubled as lookup indexes.
CREATE INDEX IF NOT EXISTS due_payments_due_period_member_idx
  ON public.due_payments (due_id, period_label, member_id);
CREATE INDEX IF NOT EXISTS contribution_payments_contribution_member_idx
  ON public.contribution_payments (contribution_id, member_id);

-- Generated once per payment form, so a double tap or a retry after a network
-- drop cannot record the same payment twice.
ALTER TABLE public.due_payments ADD COLUMN IF NOT EXISTS client_ref uuid UNIQUE;
ALTER TABLE public.contribution_payments ADD COLUMN IF NOT EXISTS client_ref uuid UNIQUE;

-- NOT VALID: enforced for new and edited rows without failing on any old zero rows.
ALTER TABLE public.due_payments
  ADD CONSTRAINT due_payments_amount_positive CHECK (amount > 0) NOT VALID;
ALTER TABLE public.contribution_payments
  ADD CONSTRAINT contribution_payments_amount_positive CHECK (amount > 0) NOT VALID;

-- Ledger descriptions: "part payment" only while the member is still short,
-- "balance paid" for the instalment that completes it.
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

  SELECT name, amount INTO _due_name, _due_amount FROM public.dues WHERE id = NEW.due_id;
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  SELECT coalesce(sum(amount), 0) + NEW.amount INTO _total
  FROM public.due_payments
  WHERE due_id = NEW.due_id AND member_id = NEW.member_id
    AND period_label = NEW.period_label AND id <> NEW.id;

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
  _c_mandatory boolean;
  _member_name text;
  _total numeric;
  _desc text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.ledger_entries WHERE source_table = 'contribution_payments' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT name, amount_per_person, mandatory INTO _c_name, _c_amount, _c_mandatory
  FROM public.contributions WHERE id = NEW.contribution_id;
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  SELECT coalesce(sum(amount), 0) + NEW.amount INTO _total
  FROM public.contribution_payments
  WHERE contribution_id = NEW.contribution_id AND member_id = NEW.member_id AND id <> NEW.id;

  _desc := coalesce(_member_name, 'Member') || ' paid for ' || coalesce(_c_name, 'contribution');
  IF coalesce(_c_mandatory, true) AND _c_amount IS NOT NULL AND _c_amount > 0 THEN
    IF _total < _c_amount THEN
      _desc := _desc || ' — part payment';
    ELSIF NEW.amount < _c_amount THEN
      _desc := _desc || ' — balance paid';
    END IF;
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
