-- PAYMENT MODES AND REFERENCES
-- Payments, event spending and ledger lines record how money moved (cash, bank transfer,
-- POS, USSD, mobile money, cheque, other) and an optional reference (bank, transfer
-- reference, receipt number). `method` stays as cash / transfer so the cash and bank
-- balances keep working: cash is cash, every other mode counts as bank.

CREATE TYPE public.payment_channel AS ENUM
  ('cash', 'bank_transfer', 'pos', 'ussd', 'mobile_money', 'cheque', 'other');

ALTER TABLE public.due_payments
  ADD COLUMN IF NOT EXISTS channel public.payment_channel,
  ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE public.contribution_payments
  ADD COLUMN IF NOT EXISTS channel public.payment_channel,
  ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE public.contribution_expenses
  ADD COLUMN IF NOT EXISTS channel public.payment_channel,
  ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS channel public.payment_channel,
  ADD COLUMN IF NOT EXISTS reference text;

-- Existing rows: cash stays cash, transfers become bank transfers. Triggers are paused
-- so this housekeeping does not show up in History or rewrite ledger descriptions.
ALTER TABLE public.due_payments DISABLE TRIGGER USER;
ALTER TABLE public.contribution_payments DISABLE TRIGGER USER;
ALTER TABLE public.contribution_expenses DISABLE TRIGGER USER;
ALTER TABLE public.ledger_entries DISABLE TRIGGER USER;
UPDATE public.due_payments SET channel = CASE method WHEN 'cash' THEN 'cash' ELSE 'bank_transfer' END::public.payment_channel WHERE channel IS NULL;
UPDATE public.contribution_payments SET channel = CASE method WHEN 'cash' THEN 'cash' ELSE 'bank_transfer' END::public.payment_channel WHERE channel IS NULL;
UPDATE public.contribution_expenses SET channel = CASE method WHEN 'cash' THEN 'cash' ELSE 'bank_transfer' END::public.payment_channel WHERE channel IS NULL;
UPDATE public.ledger_entries SET channel = CASE method WHEN 'cash' THEN 'cash' ELSE 'bank_transfer' END::public.payment_channel WHERE channel IS NULL;
ALTER TABLE public.due_payments ENABLE TRIGGER USER;
ALTER TABLE public.contribution_payments ENABLE TRIGGER USER;
ALTER TABLE public.contribution_expenses ENABLE TRIGGER USER;
ALTER TABLE public.ledger_entries ENABLE TRIGGER USER;

-- Keep method and channel in step, whichever the app sends:
--   new app: sends channel -> method follows (cash, or transfer for anything else)
--   old app: sends only method -> channel is cash or bank transfer
-- No default on channel, so the trigger can tell whether it was sent.
CREATE OR REPLACE FUNCTION public.sync_payment_channel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.channel IS NULL THEN
    NEW.channel := CASE WHEN NEW.method = 'cash' THEN 'cash' ELSE 'bank_transfer' END;
  END IF;
  NEW.method := CASE WHEN NEW.channel = 'cash' THEN 'cash' ELSE 'transfer' END;
  NEW.reference := nullif(trim(coalesce(NEW.reference, '')), '');
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['due_payments', 'contribution_payments', 'contribution_expenses', 'ledger_entries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN channel SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (reference IS NULL OR length(reference) <= 100)',
                   t, t || '_reference_length');
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'a_' || t || '_sync_channel', t);
    -- "a_" makes it run before the other BEFORE triggers (they fire in name order).
    EXECUTE format('CREATE TRIGGER a_%s_sync_channel BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.sync_payment_channel()', t, t);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_payment_channel() FROM anon, public, authenticated;

-- ---------------------------------------------------------------------------
-- Payments copy their mode and reference into the ledger
-- ---------------------------------------------------------------------------
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
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id, method, channel, reference)
    VALUES (NEW.org_id, 'income', 'Dues', _desc, NEW.amount, NEW.paid_at, 'due_payments', NEW.id, NEW.member_id, NEW.method, NEW.channel, NEW.reference);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount, entry_date = NEW.paid_at, description = _desc,
        member_id = NEW.member_id, method = NEW.method, channel = NEW.channel, reference = NEW.reference
    WHERE source_table = 'due_payments' AND source_id = NEW.id AND reversed_at IS NULL;
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
  IF (TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT name, amount_per_person, mandatory INTO _c_name, _c_amount, _c_mandatory
  FROM public.contributions WHERE id = NEW.contribution_id;
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  SELECT coalesce(sum(amount), 0) + NEW.amount INTO _total
  FROM public.contribution_payments
  WHERE contribution_id = NEW.contribution_id AND member_id = NEW.member_id
    AND id <> NEW.id AND voided_at IS NULL;

  _desc := coalesce(_member_name, 'Member') || ' paid for ' || coalesce(_c_name, 'contribution');
  IF coalesce(_c_mandatory, true) AND _c_amount IS NOT NULL AND _c_amount > 0 THEN
    IF _total < _c_amount THEN
      _desc := _desc || ' — part payment';
    ELSIF NEW.amount < _c_amount THEN
      _desc := _desc || ' — balance paid';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id, method, channel, reference)
    VALUES (NEW.org_id, 'income', 'Contribution', _desc, NEW.amount, NEW.paid_at, 'contribution_payments', NEW.id, NEW.member_id, NEW.method, NEW.channel, NEW.reference);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount, entry_date = NEW.paid_at, description = _desc,
        member_id = NEW.member_id, method = NEW.method, channel = NEW.channel, reference = NEW.reference
    WHERE source_table = 'contribution_payments' AND source_id = NEW.id AND reversed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Reversals keep the mode and reference of what they reverse.
CREATE OR REPLACE FUNCTION public._reverse_ledger_entry(_entry_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.ledger_entries;
  _new_id uuid;
BEGIN
  SELECT * INTO e FROM public.ledger_entries WHERE id = _entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ledger line not found.';
  END IF;
  IF e.reverses_id IS NOT NULL THEN
    RAISE EXCEPTION 'This line is itself a reversal and cannot be reversed.';
  END IF;
  IF e.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This line has already been reversed.';
  END IF;

  INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, method, channel, reference, member_id, reverses_id)
  VALUES (e.org_id, e.kind, e.label,
          'Reversed: ' || coalesce(e.description, e.label) || ' — ' || _reason,
          -e.amount, public.org_today(), e.method, e.channel, e.reference, e.member_id, e.id)
  RETURNING id INTO _new_id;

  UPDATE public.ledger_entries
  SET reversed_at = now(), reversed_by = auth.uid(), reverse_reason = _reason
  WHERE id = e.id;

  RETURN _new_id;
END;
$$;
REVOKE ALL ON FUNCTION public._reverse_ledger_entry(uuid, text) FROM anon, public, authenticated;

-- Posted event spending: one ledger line per payment mode.
CREATE OR REPLACE FUNCTION public.post_contribution_expenses(_contribution_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _name text;
  _posted boolean;
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;

  SELECT name, expenses_posted INTO _name, _posted
  FROM public.contributions
  WHERE id = _contribution_id AND org_id = _org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contribution not found.';
  END IF;
  IF _posted THEN
    RAISE EXCEPTION 'Spending for this event has already been posted.';
  END IF;

  INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, channel, source_table, source_id)
  SELECT _org_id, 'expense', 'Event expenses',
         'Expenses from ' || _name || ' (' || replace(e.channel::text, '_', ' ') || ')',
         sum(e.amount), public.org_today(), e.channel, 'contributions', _contribution_id
  FROM public.contribution_expenses e
  WHERE e.contribution_id = _contribution_id AND e.org_id = _org_id
  GROUP BY e.channel
  HAVING sum(e.amount) > 0;

  UPDATE public.contributions SET expenses_posted = true, closed = true WHERE id = _contribution_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_contribution_expenses(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.post_contribution_expenses(uuid) TO authenticated;

-- Opening balance lines record their mode too.
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
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, channel, source_table)
    VALUES (_org_id, 'income', 'Opening balance', 'Cash in hand when we started using FinSeka', _cash, _day, 'cash', 'opening_balance');
  END IF;
  IF coalesce(_bank, 0) > 0 THEN
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, channel, source_table)
    VALUES (_org_id, 'income', 'Opening balance', 'Money in the bank when we started using FinSeka', _bank, _day, 'bank_transfer', 'opening_balance');
  END IF;

  UPDATE public.organizations SET opening_balance_set = true WHERE id = _org_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_opening_balance(numeric, numeric, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_opening_balance(numeric, numeric, date) TO authenticated;

-- How money came in or went out, per mode, for a date range (reports and analytics).
CREATE OR REPLACE FUNCTION public.channel_totals(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'income', income, 'expense', expense)
                            ORDER BY income + expense DESC), '[]'::jsonb)
  FROM (
    SELECT channel,
           coalesce(sum(amount) FILTER (WHERE kind = 'income'), 0) AS income,
           coalesce(sum(amount) FILTER (WHERE kind = 'expense'), 0) AS expense
    FROM ledger_entries
    WHERE org_id = current_org_id()
      AND (_from IS NULL OR entry_date >= _from)
      AND (_to IS NULL OR entry_date <= _to)
    GROUP BY channel
  ) t
$$;
REVOKE ALL ON FUNCTION public.channel_totals(date, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.channel_totals(date, date) TO authenticated;
