-- CORRECTIONS AND HISTORY
-- Money records are never edited or deleted. A wrong payment is cancelled (with a
-- reason) and the ledger gets a reversing line, so balances fix themselves and the
-- history stays visible. Every change to the organization's records is logged.

-- ---------------------------------------------------------------------------
-- Cancelled payments and reversed ledger lines
-- ---------------------------------------------------------------------------
ALTER TABLE public.due_payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.contribution_payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS reverses_id uuid REFERENCES public.ledger_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reverse_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_reversal_idx
  ON public.ledger_entries (reverses_id) WHERE reverses_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Lock down writes: money rows are add-only; other records only have their
-- non-money details editable. Nothing is deleted from the app.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.due_payments FROM authenticated;
REVOKE UPDATE, DELETE ON public.contribution_payments FROM authenticated;
REVOKE UPDATE, DELETE ON public.ledger_entries FROM authenticated;
DROP POLICY IF EXISTS "ledger_update_manual" ON public.ledger_entries;
DROP POLICY IF EXISTS "ledger_delete_manual" ON public.ledger_entries;

REVOKE UPDATE, DELETE ON public.members FROM authenticated;
GRANT UPDATE (name, phone, branch_id, active, tags) ON public.members TO authenticated;

REVOKE UPDATE, DELETE ON public.dues FROM authenticated;
GRANT UPDATE (name, notes, active, penalty_amount, penalty_grace_days) ON public.dues TO authenticated;

REVOKE UPDATE, DELETE ON public.contributions FROM authenticated;
GRANT UPDATE (name, reason, due_date, budget_amount, target_amount, closed, committee) ON public.contributions TO authenticated;

REVOKE UPDATE, DELETE ON public.branches FROM authenticated;
GRANT UPDATE (name) ON public.branches TO authenticated;

-- Event spending can be changed only until it has been posted to the ledger.
DROP POLICY IF EXISTS contribution_expenses_write ON public.contribution_expenses;
CREATE POLICY contribution_expenses_write ON public.contribution_expenses
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin()
         AND NOT EXISTS (SELECT 1 FROM public.contributions c
                         WHERE c.id = contribution_id AND c.expenses_posted))
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin()
              AND NOT EXISTS (SELECT 1 FROM public.contributions c
                              WHERE c.id = contribution_id AND c.expenses_posted));

-- ---------------------------------------------------------------------------
-- Payment -> ledger triggers: ignore cancelled payments.
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
  -- Cancelling is handled by void_payment, which adds a reversing ledger line.
  IF (TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT name, amount INTO _due_name, _due_amount FROM public.dues WHERE id = NEW.due_id;
  SELECT name INTO _member_name FROM public.members WHERE id = NEW.member_id;

  SELECT coalesce(sum(amount), 0) + NEW.amount INTO _total
  FROM public.due_payments
  WHERE due_id = NEW.due_id AND member_id = NEW.member_id
    AND period_label = NEW.period_label AND id <> NEW.id AND voided_at IS NULL;

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
    INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id, method)
    VALUES (NEW.org_id, 'income', 'Contribution', _desc, NEW.amount, NEW.paid_at, 'contribution_payments', NEW.id, NEW.member_id, NEW.method);
  ELSE
    UPDATE public.ledger_entries
    SET amount = NEW.amount,
        entry_date = NEW.paid_at,
        description = _desc,
        member_id = NEW.member_id,
        method = NEW.method
    WHERE source_table = 'contribution_payments' AND source_id = NEW.id AND reversed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Reversal helper (internal) and the two correction functions the app calls.
-- ---------------------------------------------------------------------------
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

  INSERT INTO public.ledger_entries (org_id, kind, label, description, amount, entry_date, method, member_id, reverses_id)
  VALUES (e.org_id, e.kind, e.label,
          'Reversed: ' || coalesce(e.description, e.label) || ' — ' || _reason,
          -e.amount, (now() AT TIME ZONE 'Africa/Lagos')::date, e.method, e.member_id, e.id)
  RETURNING id INTO _new_id;

  UPDATE public.ledger_entries
  SET reversed_at = now(), reversed_by = auth.uid(), reverse_reason = _reason
  WHERE id = e.id;

  RETURN _new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_payment(_kind text, _payment_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _reason_clean text := trim(coalesce(_reason, ''));
  _table text;
  _voided timestamptz;
  _entry_id uuid;
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF length(_reason_clean) < 3 THEN
    RAISE EXCEPTION 'Say why this payment is being cancelled.';
  END IF;

  IF _kind = 'due' THEN
    _table := 'due_payments';
    SELECT voided_at INTO _voided FROM public.due_payments
    WHERE id = _payment_id AND org_id = _org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF _voided IS NOT NULL THEN RAISE EXCEPTION 'This payment has already been cancelled.'; END IF;
    UPDATE public.due_payments
    SET voided_at = now(), voided_by = auth.uid(), void_reason = _reason_clean
    WHERE id = _payment_id;
  ELSIF _kind = 'contribution' THEN
    _table := 'contribution_payments';
    SELECT voided_at INTO _voided FROM public.contribution_payments
    WHERE id = _payment_id AND org_id = _org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF _voided IS NOT NULL THEN RAISE EXCEPTION 'This payment has already been cancelled.'; END IF;
    UPDATE public.contribution_payments
    SET voided_at = now(), voided_by = auth.uid(), void_reason = _reason_clean
    WHERE id = _payment_id;
  ELSE
    RAISE EXCEPTION 'Unknown payment type.';
  END IF;

  SELECT id INTO _entry_id FROM public.ledger_entries
  WHERE source_table = _table AND source_id = _payment_id
    AND reverses_id IS NULL AND reversed_at IS NULL;
  IF _entry_id IS NOT NULL THEN
    PERFORM public._reverse_ledger_entry(_entry_id, 'payment cancelled: ' || _reason_clean);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_ledger_entry(_entry_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _reason_clean text := trim(coalesce(_reason, ''));
  _source text;
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF length(_reason_clean) < 3 THEN
    RAISE EXCEPTION 'Say why this line is being reversed.';
  END IF;

  SELECT source_table INTO _source FROM public.ledger_entries
  WHERE id = _entry_id AND org_id = _org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ledger line not found.';
  END IF;
  IF _source IN ('due_payments', 'contribution_payments') THEN
    RAISE EXCEPTION 'This line comes from a payment. Cancel the payment instead.';
  END IF;

  PERFORM public._reverse_ledger_entry(_entry_id, _reason_clean);
END;
$$;

REVOKE ALL ON FUNCTION public._reverse_ledger_entry(uuid, text) FROM anon, public, authenticated;
REVOKE ALL ON FUNCTION public.void_payment(text, uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.reverse_ledger_entry(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.void_payment(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_ledger_entry(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Totals ignore cancelled payments (same functions as before, one filter added).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.standing_lines(_periods jsonb, _member_id uuid DEFAULT NULL)
RETURNS TABLE (
  kind text,
  member_id uuid,
  ref_id uuid,
  ref_name text,
  period_label text,
  is_current boolean,
  is_past boolean,
  expected numeric,
  paid numeric,
  short numeric,
  penalty numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH m AS (
    SELECT id FROM members
    WHERE org_id = current_org_id()
      AND ((_member_id IS NULL AND active) OR id = _member_id)
  ),
  d AS (
    SELECT id, name, amount, frequency, penalty_amount, created_at
    FROM dues
    WHERE org_id = current_org_id() AND active
  ),
  p AS (
    SELECT d.id AS due_id, e.val ->> 'label' AS label, (e.val ->> 'ends_on')::date AS ends_on, e.ord
    FROM d
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(_periods -> d.frequency::text, '[]'::jsonb))
      WITH ORDINALITY AS e(val, ord)
  ),
  p_in AS (
    SELECT p.* FROM p JOIN d ON d.id = p.due_id
    WHERE p.ends_on IS NULL OR p.ends_on >= (d.created_at AT TIME ZONE 'Africa/Lagos')::date
  ),
  dp AS (
    SELECT due_id, member_id, period_label, sum(amount) AS paid
    FROM due_payments
    WHERE org_id = current_org_id() AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY due_id, member_id, period_label
  ),
  cp AS (
    SELECT contribution_id, member_id, sum(amount) AS paid
    FROM contribution_payments
    WHERE org_id = current_org_id() AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY contribution_id, member_id
  )
  SELECT
    'due',
    m.id,
    d.id,
    d.name,
    p_in.label,
    p_in.ord = 1,
    p_in.ord > 1 AND p_in.ends_on IS NOT NULL,
    d.amount,
    coalesce(dp.paid, 0),
    greatest(d.amount - coalesce(dp.paid, 0), 0),
    CASE WHEN p_in.ord > 1 AND p_in.ends_on IS NOT NULL AND d.amount > coalesce(dp.paid, 0)
         THEN d.penalty_amount ELSE 0 END
  FROM d
  JOIN p_in ON p_in.due_id = d.id
  CROSS JOIN m
  LEFT JOIN dp ON dp.due_id = d.id AND dp.member_id = m.id AND dp.period_label = p_in.label
  UNION ALL
  SELECT
    'contribution',
    cm.member_id,
    c.id,
    c.name,
    NULL,
    NOT c.closed,
    false,
    c.amount_per_person,
    coalesce(cp.paid, 0),
    greatest(c.amount_per_person - coalesce(cp.paid, 0), 0),
    0
  FROM contribution_members cm
  JOIN contributions c ON c.id = cm.contribution_id AND c.mandatory
  JOIN m ON m.id = cm.member_id
  LEFT JOIN cp ON cp.contribution_id = c.id AND cp.member_id = cm.member_id
  WHERE c.org_id = current_org_id()
$$;

CREATE OR REPLACE FUNCTION public.contribution_progress(_open_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH c AS (
    SELECT id, name, amount_per_person, target_amount, due_date, closed, created_at
    FROM contributions
    WHERE org_id = current_org_id() AND (NOT _open_only OR NOT closed)
  ),
  per_member AS (
    SELECT contribution_id, member_id, sum(amount) AS paid
    FROM contribution_payments
    WHERE org_id = current_org_id() AND voided_at IS NULL
    GROUP BY contribution_id, member_id
  ),
  stats AS (
    SELECT
      c.id,
      (SELECT count(*) FROM contribution_members cm WHERE cm.contribution_id = c.id) AS picked,
      (SELECT count(*) FROM contribution_members cm
         JOIN per_member pm ON pm.contribution_id = cm.contribution_id AND pm.member_id = cm.member_id
         WHERE cm.contribution_id = c.id
           AND CASE WHEN c.amount_per_person > 0 THEN pm.paid >= c.amount_per_person ELSE pm.paid > 0 END
      ) AS paid_people,
      (SELECT coalesce(sum(paid), 0) FROM per_member pm WHERE pm.contribution_id = c.id) AS collected
    FROM c
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'closed', c.closed,
      'due_date', c.due_date,
      'picked', s.picked,
      'paid_people', s.paid_people,
      'collected', s.collected,
      'target', coalesce(nullif(c.target_amount, 0), s.picked * c.amount_per_person)
    ) ORDER BY c.closed, c.due_date NULLS LAST, c.created_at DESC), '[]'::jsonb)
  FROM c JOIN stats s ON s.id = c.id
$$;

-- ---------------------------------------------------------------------------
-- History (audit log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL,          -- no foreign key, so history can never block a delete
  actor_id uuid,                 -- null when done by the system (e.g. an invite)
  table_name text NOT NULL,
  row_id uuid,
  action text NOT NULL,          -- insert / update / delete
  old_row jsonb,
  new_row jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_at_idx ON public.audit_log (org_id, at DESC, id DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
-- Everyone in the organization can read its history; nobody can change it.
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());

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
     AND (TG_OP = 'UPDATE' OR _row ->> 'source_table' IN ('due_payments', 'contribution_payments')) THEN
    RETURN NULL;
  END IF;

  _org_id := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (_row ->> 'id')::uuid
                  ELSE (_row ->> 'org_id')::uuid END;
  IF _org_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_log (org_id, actor_id, table_name, row_id, action, old_row, new_row)
  VALUES (_org_id, auth.uid(), TG_TABLE_NAME, (_row ->> 'id')::uuid, lower(TG_OP), _old, _new);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_row() FROM anon, public, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'branches', 'members', 'dues', 'due_payments', 'contributions',
    'contribution_members', 'contribution_payments', 'contribution_expenses',
    'ledger_entries', 'user_roles'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
       FOR EACH ROW EXECUTE FUNCTION public.audit_row()', t);
  END LOOP;
END;
$$;
