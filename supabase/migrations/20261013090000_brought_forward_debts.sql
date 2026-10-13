-- DEBTS BROUGHT FORWARD
--
-- What members already owed before the organization started using FinSeka, written in as
-- labelled lines ("Old dues ₦6,000", "Building levy ₦5,000"), the way the opening balance
-- brings forward cash in hand and in the bank.
--
-- * A brought-forward debt is owed money, not money received: it never enters the ledger.
--   When the member pays it, that payment is income on the day it is paid.
-- * It counts in what the member owes (member_balances, standing_lines), so the dashboard,
--   reports, statements and reminders include it, and "pay what this member owes" pays it
--   first (it is the oldest debt).
-- * Payments against it work like other payments: mode, reference, date, part payments,
--   cancelling (which reverses the ledger line), closed financial years, history.
-- * A debt entered by mistake is cancelled with a reason, not deleted; money already paid
--   towards it stays recorded.

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brought_forward_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  label text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  as_of date NOT NULL DEFAULT public.org_today(),
  note text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brought_forward_debts_label_present CHECK (length(trim(label)) BETWEEN 1 AND 200),
  CONSTRAINT brought_forward_debts_note_length CHECK (coalesce(length(note), 0) <= 500),
  CONSTRAINT brought_forward_debts_date_sane CHECK (as_of BETWEEN '1990-01-01' AND '2100-01-01')
);
CREATE INDEX IF NOT EXISTS brought_forward_debts_org_idx ON public.brought_forward_debts (org_id);
CREATE INDEX IF NOT EXISTS brought_forward_debts_member_idx ON public.brought_forward_debts (member_id);

CREATE TABLE IF NOT EXISTS public.brought_forward_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL REFERENCES public.brought_forward_debts(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_at date NOT NULL DEFAULT public.org_today(),
  method public.payment_method NOT NULL DEFAULT 'cash',
  channel public.payment_channel NOT NULL,
  reference text CHECK (reference IS NULL OR length(reference) <= 100),
  note text,
  client_ref uuid UNIQUE,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brought_forward_payments_org_idx ON public.brought_forward_payments (org_id);
CREATE INDEX IF NOT EXISTS brought_forward_payments_debt_idx ON public.brought_forward_payments (debt_id);
CREATE INDEX IF NOT EXISTS brought_forward_payments_member_idx ON public.brought_forward_payments (member_id);

-- ---------------------------------------------------------------------------
-- Access: everyone in the organization reads; admins write. Debts are cancelled (not
-- deleted) through cancel_brought_forward_debt; payments are add-only and cancelled
-- through void_payment.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brought_forward_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brought_forward_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.brought_forward_debts, public.brought_forward_payments FROM anon, public;
GRANT SELECT, INSERT ON public.brought_forward_debts TO authenticated;
GRANT UPDATE (label, amount, as_of, note) ON public.brought_forward_debts TO authenticated;
GRANT SELECT, INSERT ON public.brought_forward_payments TO authenticated;
GRANT ALL ON public.brought_forward_debts, public.brought_forward_payments TO service_role;

CREATE POLICY brought_forward_debts_select ON public.brought_forward_debts
  FOR SELECT TO authenticated USING (org_id = (SELECT public.current_org_id()));
CREATE POLICY brought_forward_debts_write ON public.brought_forward_debts
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.current_org_id()) AND (SELECT public.is_org_admin()))
  WITH CHECK (org_id = (SELECT public.current_org_id()) AND (SELECT public.is_org_admin()));

CREATE POLICY brought_forward_payments_select ON public.brought_forward_payments
  FOR SELECT TO authenticated USING (org_id = (SELECT public.current_org_id()));
CREATE POLICY brought_forward_payments_insert ON public.brought_forward_payments
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT public.current_org_id()) AND (SELECT public.is_org_admin())
              AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL);

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
-- A debt belongs to a member of the same organization, stays with them, and is never set
-- below what has already been paid towards it.
CREATE OR REPLACE FUNCTION public.check_brought_forward_debt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _paid numeric;
BEGIN
  NEW.label := trim(coalesce(NEW.label, ''));
  NEW.note := nullif(trim(coalesce(NEW.note, '')), '');
  IF TG_OP = 'INSERT' THEN
    -- A new debt is always open; cancelling goes through cancel_brought_forward_debt.
    NEW.cancelled_at := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancel_reason := NULL;
    IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'Member not found.';
    END IF;
  ELSE
    IF NEW.org_id <> OLD.org_id OR NEW.member_id <> OLD.member_id THEN
      RAISE EXCEPTION 'A debt brought forward stays with its member.';
    END IF;
    IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT NULL
       AND (NEW.amount <> OLD.amount OR NEW.label <> OLD.label OR NEW.as_of <> OLD.as_of) THEN
      RAISE EXCEPTION 'This debt was cancelled.';
    END IF;
    IF NEW.amount < OLD.amount THEN
      SELECT coalesce(sum(amount), 0) INTO _paid FROM brought_forward_payments
      WHERE debt_id = NEW.id AND voided_at IS NULL;
      IF NEW.amount < _paid THEN
        RAISE EXCEPTION 'The debt cannot be less than what has already been paid (₦%).',
          to_char(_paid, 'FM999,999,999,990.##');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_brought_forward_debt() FROM anon, public, authenticated;

CREATE TRIGGER b_brought_forward_debts_check BEFORE INSERT OR UPDATE ON public.brought_forward_debts
  FOR EACH ROW EXECUTE FUNCTION public.check_brought_forward_debt();

-- A payment belongs to an open debt, is for its member, and never takes it past what was owed.
CREATE OR REPLACE FUNCTION public.check_brought_forward_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d record;
  _paid numeric;
BEGIN
  SELECT * INTO d FROM brought_forward_debts WHERE id = NEW.debt_id AND org_id = NEW.org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt not found.';
  END IF;
  IF d.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This debt was cancelled.';
  END IF;
  NEW.member_id := d.member_id;
  SELECT coalesce(sum(amount), 0) INTO _paid FROM brought_forward_payments
  WHERE debt_id = NEW.debt_id AND voided_at IS NULL;
  IF _paid + NEW.amount > d.amount THEN
    RAISE EXCEPTION 'That is more than is left on this debt (₦%).',
      to_char(d.amount - _paid, 'FM999,999,999,990.##');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_brought_forward_payment() FROM anon, public, authenticated;

-- "a0" refuses changes while the plan has ended, "a_" keeps method and channel in step, then the
-- debt check, then the year lock.
CREATE TRIGGER a_brought_forward_payments_sync_channel BEFORE INSERT OR UPDATE ON public.brought_forward_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_payment_channel();
CREATE TRIGGER b_brought_forward_payments_check BEFORE INSERT ON public.brought_forward_payments
  FOR EACH ROW EXECUTE FUNCTION public.check_brought_forward_payment();
CREATE TRIGGER closed_year_brought_forward_payments BEFORE INSERT OR UPDATE ON public.brought_forward_payments
  FOR EACH ROW EXECUTE FUNCTION public.refuse_closed_year('paid_at');
CREATE TRIGGER a0_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.brought_forward_debts
  FOR EACH ROW EXECUTE FUNCTION public.refuse_when_read_only();
CREATE TRIGGER a0_read_only BEFORE INSERT OR UPDATE OR DELETE ON public.brought_forward_payments
  FOR EACH ROW EXECUTE FUNCTION public.refuse_when_read_only();

-- Each payment becomes one "money in" ledger line.
CREATE OR REPLACE FUNCTION public.sync_brought_forward_payment_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d record;
  _name text;
  _paid numeric;
  _desc text;
BEGIN
  SELECT * INTO d FROM brought_forward_debts WHERE id = NEW.debt_id;
  SELECT name INTO _name FROM members WHERE id = d.member_id;
  SELECT coalesce(sum(amount), 0) INTO _paid FROM brought_forward_payments
  WHERE debt_id = d.id AND voided_at IS NULL;

  _desc := coalesce(_name, 'A member') || ' paid ' || d.label || ' (brought forward)';
  IF _paid < d.amount THEN
    _desc := _desc || ' — part';
  ELSIF NEW.amount < d.amount THEN
    _desc := _desc || ' — balance';
  END IF;

  INSERT INTO ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id, method, channel, reference)
  VALUES (NEW.org_id, 'income', 'Debt brought forward', _desc, NEW.amount, NEW.paid_at,
          'brought_forward_payments', NEW.id, d.member_id, NEW.method, NEW.channel, NEW.reference);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_brought_forward_payment_ledger() FROM anon, public, authenticated;

CREATE TRIGGER brought_forward_payments_ledger AFTER INSERT ON public.brought_forward_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_brought_forward_payment_ledger();

-- Cancel a debt entered by mistake. Money already paid towards it stays recorded.
CREATE OR REPLACE FUNCTION public.cancel_brought_forward_debt(_debt_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
  _reason_clean text := trim(coalesce(_reason, ''));
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF length(_reason_clean) < 3 THEN
    RAISE EXCEPTION 'Say why this debt is being cancelled.';
  END IF;
  UPDATE public.brought_forward_debts
  SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = _reason_clean
  WHERE id = _debt_id AND org_id = _org_id AND cancelled_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debt not found, or already cancelled.';
  END IF;
END;
$$;

-- Where each debt stands.
CREATE OR REPLACE VIEW public.brought_forward_status
WITH (security_invoker = true)
AS
SELECT b.id, b.org_id, b.member_id, b.label, b.amount, b.as_of, b.note,
       b.cancelled_at, b.cancel_reason, b.created_at,
       coalesce(p.paid, 0)::numeric(14,2) AS paid,
       CASE WHEN b.cancelled_at IS NOT NULL THEN 0
            ELSE greatest(b.amount - coalesce(p.paid, 0), 0) END::numeric(14,2) AS outstanding,
       p.last_paid_at
FROM public.brought_forward_debts b
LEFT JOIN LATERAL (
  SELECT sum(amount) AS paid, max(paid_at) AS last_paid_at
  FROM public.brought_forward_payments x
  WHERE x.debt_id = b.id AND x.voided_at IS NULL
) p ON true;

REVOKE ALL ON public.brought_forward_status FROM anon, public;
GRANT SELECT ON public.brought_forward_status TO authenticated;

-- ---------------------------------------------------------------------------
-- The onboarding step: until an admin says it is done, the dashboard asks for what members
-- owed. Organizations already using FinSeka have long been set up, so it starts as done for them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS brought_forward_done boolean NOT NULL DEFAULT false;
UPDATE public.organizations SET brought_forward_done = true WHERE NOT brought_forward_done;

CREATE OR REPLACE FUNCTION public.set_brought_forward_done(_done boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid := public.current_org_id();
BEGIN
  IF _org_id IS NULL OR NOT public.is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  UPDATE public.organizations SET brought_forward_done = coalesce(_done, true) WHERE id = _org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- What members owe now includes debts brought forward
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.member_balances(jsonb, uuid);
DROP FUNCTION IF EXISTS public.member_balances(uuid);

CREATE OR REPLACE FUNCTION public.member_balances(_member_id uuid DEFAULT NULL)
RETURNS TABLE (
  member_id uuid,
  name text,
  dues_owing numeric,
  penalties numeric,
  contributions_owing numeric,
  brought_forward numeric,
  total_owing numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (SELECT org_today() AS today),
  m AS MATERIALIZED (
    SELECT id, name, joined_on, tags, branch_id FROM members
    WHERE org_id = (SELECT current_org_id()) AND ((_member_id IS NULL AND active) OR id = _member_id)
  ),
  d AS MATERIALIZED (
    SELECT id, frequency, starts_on, coalesce(penalty_amount, 0) AS penalty_amount,
           coalesce(penalty_grace_days, 0) AS grace, audience, audience_labels, audience_branch_ids
    FROM dues WHERE org_id = (SELECT current_org_id()) AND active
  ),
  -- Every period of every due up to today, its price, and whether its late charge applies.
  p AS MATERIALIZED (
    SELECT d.id AS due_id, x.period_start,
           due_amount_for(d.id, x.period_start) AS expected,
           (x.period_end IS NOT NULL AND t.today > x.period_end + d.grace) AS late
    FROM d, t, LATERAL due_periods(d.frequency, d.starts_on, t.today) x
  ),
  -- From each period to today: what was charged, and how many periods carry a late charge.
  from_period AS MATERIALIZED (
    SELECT due_id, period_start,
           sum(expected) OVER w AS charged,
           count(*) FILTER (WHERE late AND expected > 0) OVER w AS late_periods
    FROM p
    WINDOW w AS (PARTITION BY due_id ORDER BY period_start DESC)
  ),
  -- Who each due applies to, and the first period they are charged for (the one they joined in).
  dm AS MATERIALIZED (
    SELECT d.id AS due_id, m.id AS member_id, d.penalty_amount,
           CASE WHEN d.frequency = 'custom' THEN d.starts_on
                ELSE greatest(period_start_of(d.frequency, m.joined_on),
                              period_start_of(d.frequency, d.starts_on)) END AS first_start
    FROM d JOIN m
      ON due_applies_to(d.id, d.audience, d.audience_labels, d.audience_branch_ids, m.id, m.tags, m.branch_id)
  ),
  -- Each due's prices and late flags as lists in period order, so a payment finds its period's
  -- price by position (its month, week, day or year number) rather than by a join.
  prices AS MATERIALIZED (
    SELECT p.due_id, d.frequency, min(p.period_start) AS first_period,
           array_agg(p.expected ORDER BY p.period_start) AS expected,
           array_agg(p.late ORDER BY p.period_start) AS late
    FROM p JOIN d ON d.id = p.due_id
    GROUP BY p.due_id, d.frequency
  ),
  -- Each member's payments per period they are charged for, looked up member by member and due by
  -- due. (Postgres plans for an average-sized organization; this way a large one costs one index
  -- lookup per member and due, not one per member and period.)
  paid AS MATERIALIZED (
    SELECT member_id, paid, penalty_amount, expected[n] AS expected, late[n] AS late
    FROM (
      SELECT y.member_id, y.paid, y.penalty_amount, pr.expected, pr.late,
             period_number(pr.frequency, pr.first_period, y.period_start) + 1 AS n
      FROM (
        SELECT dm.due_id, dm.member_id, max(dm.penalty_amount) AS penalty_amount, x.period_start,
               sum(x.amount) AS paid
        FROM dm
        JOIN due_payments x ON x.due_id = dm.due_id AND x.member_id = dm.member_id
        WHERE x.voided_at IS NULL AND x.period_start >= dm.first_start
          AND (_member_id IS NULL OR x.member_id = _member_id)
        GROUP BY dm.due_id, dm.member_id, x.period_start
      ) y
      JOIN prices pr ON pr.due_id = y.due_id
    ) z
    WHERE n BETWEEN 1 AND cardinality(expected)   -- payments for periods after today are ignored
  ),
  -- Charged (+) and paid (−) rows, added up per member. (Adding them up rather than joining them
  -- keeps the work proportional to the rows, whatever Postgres guesses about their number.)
  due_parts AS (
    SELECT dm.member_id, coalesce(f.charged, 0) AS short,
           dm.penalty_amount * coalesce(f.late_periods, 0) AS penalty
    FROM dm
    LEFT JOIN from_period f ON f.due_id = dm.due_id AND f.period_start = dm.first_start
    UNION ALL
    -- What each payment covers: never more than its period's price; a period paid in full
    -- carries no late charge.
    SELECT member_id, -least(paid, expected),
           CASE WHEN late AND expected > 0 AND paid >= expected THEN -penalty_amount ELSE 0 END
    FROM paid
  ),
  due_totals AS (
    SELECT member_id, sum(short) AS short, sum(penalty) AS penalty FROM due_parts GROUP BY member_id
  ),
  cp AS (
    SELECT contribution_id, member_id, sum(amount) AS paid
    FROM contribution_payments
    WHERE org_id = (SELECT current_org_id()) AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY contribution_id, member_id
  ),
  contribution_totals AS (
    SELECT cm.member_id, sum(greatest(c.amount_per_person - coalesce(cp.paid, 0), 0)) AS short
    FROM contribution_members cm
    JOIN contributions c ON c.id = cm.contribution_id AND c.mandatory
    JOIN m ON m.id = cm.member_id
    LEFT JOIN cp ON cp.contribution_id = c.id AND cp.member_id = cm.member_id
    WHERE c.org_id = (SELECT current_org_id())
    GROUP BY cm.member_id
  ),
  -- What is left of each member's debts brought forward from before FinSeka.
  bf_paid AS (
    SELECT debt_id, sum(amount) AS paid
    FROM brought_forward_payments
    WHERE org_id = (SELECT current_org_id()) AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY debt_id
  ),
  bf_totals AS (
    SELECT b.member_id, sum(greatest(b.amount - coalesce(bp.paid, 0), 0)) AS short
    FROM brought_forward_debts b
    JOIN m ON m.id = b.member_id
    LEFT JOIN bf_paid bp ON bp.debt_id = b.id
    WHERE b.org_id = (SELECT current_org_id()) AND b.cancelled_at IS NULL
    GROUP BY b.member_id
  )
  SELECT m.id, m.name,
         coalesce(dt.short, 0),
         coalesce(dt.penalty, 0),
         coalesce(ct.short, 0),
         coalesce(bt.short, 0),
         coalesce(dt.short, 0) + coalesce(dt.penalty, 0) + coalesce(ct.short, 0) + coalesce(bt.short, 0)
  FROM m
  LEFT JOIN due_totals dt ON dt.member_id = m.id
  LEFT JOIN contribution_totals ct ON ct.member_id = m.id
  LEFT JOIN bf_totals bt ON bt.member_id = m.id
$$;

-- The older form some clients may still call.
CREATE OR REPLACE FUNCTION public.member_balances(_periods jsonb, _member_id uuid DEFAULT NULL)
RETURNS TABLE (
  member_id uuid,
  name text,
  dues_owing numeric,
  penalties numeric,
  contributions_owing numeric,
  brought_forward numeric,
  total_owing numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT * FROM member_balances(_member_id) $$;

CREATE OR REPLACE FUNCTION public.standing_lines(_member_id uuid DEFAULT NULL)
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
    SELECT id, joined_on, tags, branch_id FROM members
    WHERE org_id = current_org_id() AND ((_member_id IS NULL AND active) OR id = _member_id)
  ),
  d AS (
    SELECT id, name, frequency, penalty_amount, penalty_grace_days, starts_on,
           audience, audience_labels, audience_branch_ids
    FROM dues WHERE org_id = current_org_id() AND active
  ),
  dm AS (
    SELECT d.id AS due_id, m.id AS member_id, m.joined_on
    FROM d JOIN m
      ON due_applies_to(d.id, d.audience, d.audience_labels, d.audience_branch_ids, m.id, m.tags, m.branch_id)
  ),
  p AS MATERIALIZED (
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
  ),
  bp AS (
    SELECT debt_id, sum(amount) AS paid
    FROM brought_forward_payments
    WHERE org_id = current_org_id() AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY debt_id
  )
  SELECT
    'due', dm.member_id, d.id, d.name, p.label,
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
  JOIN dm ON dm.due_id = d.id AND (p.period_end IS NULL OR p.period_end >= dm.joined_on)
  CROSS JOIN t
  LEFT JOIN dp ON dp.due_id = d.id AND dp.member_id = dm.member_id AND dp.period_start = p.period_start
  UNION ALL
  SELECT
    'contribution', cm.member_id, c.id, c.name, NULL, NOT c.closed, false,
    c.amount_per_person, coalesce(cp.paid, 0),
    greatest(c.amount_per_person - coalesce(cp.paid, 0), 0), 0,
    (c.created_at AT TIME ZONE 'Africa/Lagos')::date, c.due_date
  FROM contribution_members cm
  JOIN contributions c ON c.id = cm.contribution_id AND c.mandatory
  JOIN m ON m.id = cm.member_id
  LEFT JOIN cp ON cp.contribution_id = c.id AND cp.member_id = cm.member_id
  WHERE c.org_id = current_org_id()
  UNION ALL
  -- Debts brought forward from before FinSeka: one line each, dated the day they were owed.
  SELECT
    'brought_forward', b.member_id, b.id, b.label, NULL, false, true,
    b.amount, coalesce(bp.paid, 0), greatest(b.amount - coalesce(bp.paid, 0), 0), 0,
    b.as_of, b.as_of
  FROM brought_forward_debts b
  JOIN m ON m.id = b.member_id
  LEFT JOIN bp ON bp.debt_id = b.id
  WHERE b.org_id = current_org_id() AND b.cancelled_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.pay_member_debts(
  _member_id uuid,
  _amount numeric,
  _paid_at date,
  _channel public.payment_channel,
  _reference text DEFAULT NULL,
  _note text DEFAULT NULL,
  _client_ref uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _org_id uuid := current_org_id();
  _left numeric := _amount;
  _owed numeric;
  _n int := 0;
  _part numeric;
  _ref uuid;
  _rows int;
  _done jsonb := '[]'::jsonb;
  l record;
BEGIN
  IF _org_id IS NULL OR NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only an admin of an organization can do this.';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'A payment must be more than ₦0.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = _member_id AND org_id = _org_id) THEN
    RAISE EXCEPTION 'Member not found.';
  END IF;

  SELECT coalesce(sum(short), 0) INTO _owed FROM standing_lines(_member_id) WHERE short > 0;
  IF _amount > _owed THEN
    RAISE EXCEPTION 'That is more than they owe (₦%). Record the extra as a donation in the ledger.',
      to_char(_owed, 'FM999,999,999,990.##');
  END IF;

  FOR l IN
    SELECT * FROM standing_lines(_member_id)
    WHERE short > 0
    ORDER BY kind <> 'brought_forward', coalesce(period_start, '9999-12-31'::date), kind DESC, ref_name
  LOOP
    EXIT WHEN _left <= 0;
    _part := least(_left, l.short);
    _n := _n + 1;
    -- A stable reference per part, so saving the same payment twice records it once.
    _ref := CASE WHEN _client_ref IS NULL THEN NULL
                 ELSE md5(_client_ref::text || ':' || _n)::uuid END;

    IF l.kind = 'due' THEN
      INSERT INTO due_payments (org_id, due_id, member_id, period_start, period_label, amount, paid_at, channel, reference, note, client_ref)
      VALUES (_org_id, l.ref_id, _member_id, l.period_start, l.period_label, _part, _paid_at, _channel, _reference, _note, _ref)
      ON CONFLICT (client_ref) DO NOTHING;
    ELSIF l.kind = 'brought_forward' THEN
      INSERT INTO brought_forward_payments (org_id, debt_id, amount, paid_at, channel, reference, note, client_ref)
      VALUES (_org_id, l.ref_id, _part, _paid_at, _channel, _reference, _note, _ref)
      ON CONFLICT (client_ref) DO NOTHING;
    ELSE
      INSERT INTO contribution_payments (org_id, contribution_id, member_id, amount, paid_at, channel, reference, note, client_ref)
      VALUES (_org_id, l.ref_id, _member_id, _part, _paid_at, _channel, _reference, _note, _ref)
      ON CONFLICT (client_ref) DO NOTHING;
    END IF;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    IF _rows = 0 THEN
      -- already saved (a retry): nothing more to do
      RETURN jsonb_build_object('already_saved', true, 'parts', '[]'::jsonb);
    END IF;

    _done := _done || jsonb_build_array(jsonb_build_object(
      'kind', l.kind, 'name', l.ref_name, 'period', l.period_label, 'amount', _part));
    _left := _left - _part;
  END LOOP;

  RETURN jsonb_build_object('already_saved', false, 'parts', _done);
END;
$$;

-- Analytics counts what is left of them too (late from the day they were owed).
CREATE OR REPLACE FUNCTION public.analytics_summary(
  _from date,
  _to date,
  _branch_id uuid DEFAULT NULL,
  _label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (SELECT org_today() AS today),
  mem AS MATERIALIZED (
    SELECT id, name, joined_on, tags, branch_id FROM members
    WHERE org_id = (SELECT current_org_id()) AND active
      AND (_branch_id IS NULL OR branch_id = _branch_id)
      AND (_label IS NULL OR _label = ANY (tags))
  ),
  months AS (
    SELECT generate_series(date_trunc('month', _from), date_trunc('month', _to), interval '1 month')::date AS m
  ),
  money AS (
    SELECT date_trunc('month', entry_date)::date AS m,
           sum(CASE WHEN kind = 'income' THEN amount ELSE 0 END) AS income,
           sum(CASE WHEN kind = 'expense' THEN amount ELSE 0 END) AS expense
    FROM ledger_entries
    WHERE org_id = (SELECT current_org_id()) AND entry_date BETWEEN _from AND _to
    GROUP BY 1
  ),
  d AS MATERIALIZED (
    SELECT id, name, frequency, starts_on, coalesce(penalty_amount, 0) AS penalty_amount,
           coalesce(penalty_grace_days, 0) AS grace, audience, audience_labels, audience_branch_ids
    FROM dues WHERE org_id = (SELECT current_org_id()) AND active
  ),
  -- Every period of every due up to today: price, late charge, and its lateness band (1-4).
  p AS MATERIALIZED (
    SELECT d.id AS due_id, x.period_start, due_amount_for(d.id, x.period_start) AS expected,
           (x.period_end IS NOT NULL AND t.today > x.period_end + d.grace) AS late,
           CASE WHEN x.period_end IS NULL OR x.period_end >= t.today THEN 1
                WHEN t.today - x.period_end <= 30 THEN 2
                WHEN t.today - x.period_end <= 90 THEN 3
                ELSE 4 END AS band
    FROM d, t, LATERAL due_periods(d.frequency, d.starts_on, t.today) x
  ),
  dm AS MATERIALIZED (
    SELECT d.id AS due_id, mem.id AS member_id, d.penalty_amount,
           CASE WHEN d.frequency = 'custom' THEN d.starts_on
                ELSE greatest(period_start_of(d.frequency, mem.joined_on),
                              period_start_of(d.frequency, d.starts_on)) END AS first_start
    FROM d JOIN mem
      ON due_applies_to(d.id, d.audience, d.audience_labels, d.audience_branch_ids, mem.id, mem.tags, mem.branch_id)
  ),
  -- Each member's payments, period by period, within the periods they are charged for.
  -- Prices, late flags and lateness bands as lists in period order (see member_balances).
  prices AS MATERIALIZED (
    SELECT p.due_id, d.frequency, min(p.period_start) AS first_period,
           array_agg(p.expected ORDER BY p.period_start) AS expected,
           array_agg(p.late ORDER BY p.period_start) AS late,
           array_agg(p.band ORDER BY p.period_start) AS band
    FROM p JOIN d ON d.id = p.due_id
    GROUP BY p.due_id, d.frequency
  ),
  -- Each member's payments, period by period, looked up member by member (see member_balances).
  lines_paid AS MATERIALIZED (
    SELECT due_id, member_id, penalty_amount, period_start, band[n] AS band, late[n] AS late,
           expected[n] AS expected, least(paid, expected[n]) AS covered, paid >= expected[n] AS paid_in_full
    FROM (
      SELECT y.due_id, y.member_id, y.penalty_amount, y.period_start, y.paid,
             pr.expected, pr.late, pr.band,
             period_number(pr.frequency, pr.first_period, y.period_start) + 1 AS n
      FROM (
        SELECT dm.due_id, dm.member_id, max(dm.penalty_amount) AS penalty_amount, x.period_start,
               sum(x.amount) AS paid
        FROM dm
        JOIN due_payments x ON x.due_id = dm.due_id AND x.member_id = dm.member_id
        WHERE x.voided_at IS NULL AND x.period_start >= dm.first_start
        GROUP BY dm.due_id, dm.member_id, x.period_start
      ) y
      JOIN prices pr ON pr.due_id = y.due_id
    ) z
    WHERE n BETWEEN 1 AND cardinality(expected)
  ),
  -- Within each band, from each period to the band's last: charged, late periods, priced periods.
  band_from AS MATERIALIZED (
    SELECT due_id, band, period_start,
           sum(expected) OVER w AS charged,
           count(*) FILTER (WHERE late AND expected > 0) OVER w AS late_n,
           count(*) FILTER (WHERE expected > 0) OVER w AS priced_n
    FROM p
    WINDOW w AS (PARTITION BY due_id, band ORDER BY period_start DESC)
  ),
  band_start AS (SELECT due_id, band, min(period_start) AS first_period FROM p GROUP BY due_id, band),
  member_band AS (
    SELECT dm.due_id, dm.member_id, dm.penalty_amount, b.band, f.charged, f.late_n, f.priced_n
    FROM dm
    JOIN band_start b ON b.due_id = dm.due_id
    JOIN band_from f ON f.due_id = dm.due_id AND f.band = b.band
                    AND f.period_start = greatest(dm.first_start, b.first_period)
  ),
  -- Charged (+) and paid (−) rows per member and band, added up rather than joined.
  due_parts AS (
    SELECT due_id, member_id, band, charged + penalty_amount * late_n AS amount,
           priced_n AS priced, 0::bigint AS paid_full
    FROM member_band
    UNION ALL
    SELECT due_id, member_id, band,
           -covered - CASE WHEN late AND expected > 0 AND paid_in_full THEN penalty_amount ELSE 0 END,
           0, CASE WHEN expected > 0 AND paid_in_full THEN 1 ELSE 0 END
    FROM lines_paid
  ),
  cp AS (
    SELECT contribution_id, member_id, sum(amount) AS paid
    FROM contribution_payments WHERE org_id = (SELECT current_org_id()) AND voided_at IS NULL
    GROUP BY contribution_id, member_id
  ),
  -- Unpaid money by member and lateness band: dues, then compulsory contributions.
  unpaid AS (
    SELECT member_id, band, sum(amount) AS amount, sum(priced) > sum(paid_full) AS owes
    FROM due_parts GROUP BY due_id, member_id, band
    UNION ALL
    SELECT cm.member_id,
           CASE WHEN c.due_date IS NULL OR c.due_date >= t.today THEN 1
                WHEN t.today - c.due_date <= 30 THEN 2
                WHEN t.today - c.due_date <= 90 THEN 3 ELSE 4 END,
           c.amount_per_person - coalesce(cp.paid, 0),
           true
    FROM contribution_members cm
    JOIN contributions c ON c.id = cm.contribution_id AND c.mandatory
    JOIN mem ON mem.id = cm.member_id
    LEFT JOIN cp ON cp.contribution_id = c.id AND cp.member_id = cm.member_id
    CROSS JOIN t
    WHERE c.org_id = (SELECT current_org_id()) AND c.amount_per_person > coalesce(cp.paid, 0)
    UNION ALL
    -- Debts brought forward: late from the day they were owed.
    SELECT b.member_id,
           CASE WHEN b.as_of >= t.today THEN 1
                WHEN t.today - b.as_of <= 30 THEN 2
                WHEN t.today - b.as_of <= 90 THEN 3 ELSE 4 END,
           b.amount - coalesce(bp.paid, 0),
           true
    FROM brought_forward_debts b
    JOIN mem ON mem.id = b.member_id
    LEFT JOIN (
      SELECT debt_id, sum(amount) AS paid FROM brought_forward_payments
      WHERE org_id = (SELECT current_org_id()) AND voided_at IS NULL GROUP BY debt_id
    ) bp ON bp.debt_id = b.id
    CROSS JOIN t
    WHERE b.org_id = (SELECT current_org_id()) AND b.cancelled_at IS NULL AND b.amount > coalesce(bp.paid, 0)
  ),
  -- Dues for periods starting in the range: charged to every member who had joined by then.
  in_range AS MATERIALIZED (
    SELECT p.due_id, p.period_start, p.expected,
           (SELECT count(*) FROM dm WHERE dm.due_id = p.due_id AND dm.first_start <= p.period_start) AS members
    FROM p WHERE p.period_start BETWEEN _from AND _to
  ),
  range_paid AS (
    SELECT due_id, period_start, sum(covered) AS covered
    FROM lines_paid WHERE period_start BETWEEN _from AND _to
    GROUP BY due_id, period_start
  ),
  due_lines AS (
    SELECT r.due_id, r.period_start, r.members, r.expected * r.members AS expected,
           coalesce(rp.covered, 0) AS collected
    FROM in_range r
    LEFT JOIN range_paid rp ON rp.due_id = r.due_id AND rp.period_start = r.period_start
    WHERE r.members > 0
  ),
  collection AS (
    SELECT date_trunc('month', period_start)::date AS m, sum(expected) AS expected, sum(collected) AS collected
    FROM due_lines GROUP BY 1
  )
  SELECT jsonb_build_object(
    'from', _from, 'to', _to,
    'totals', ledger_totals(_from, _to),
    'monthly', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'month', months.m,
               'income', coalesce(money.income, 0),
               'expense', coalesce(money.expense, 0),
               'expected', coalesce(collection.expected, 0),
               'collected', coalesce(collection.collected, 0)) ORDER BY months.m), '[]'::jsonb)
      FROM months
      LEFT JOIN money ON money.m = months.m
      LEFT JOIN collection ON collection.m = months.m
    ),
    'collection', jsonb_build_object(
      'expected', (SELECT coalesce(sum(expected), 0) FROM due_lines),
      'collected', (SELECT coalesce(sum(collected), 0) FROM due_lines)
    ),
    'aging', (
      SELECT jsonb_agg(jsonb_build_object('bucket', b.name, 'amount', coalesce(x.amount, 0),
                                          'people', coalesce(x.people, 0)) ORDER BY b.ord)
      FROM (VALUES (1, 'Not yet late'), (2, 'Up to 1 month late'), (3, '1–3 months late'),
                   (4, 'Over 3 months late')) AS b(ord, name)
      LEFT JOIN (
        SELECT band AS ord, sum(amount) FILTER (WHERE owes) AS amount,
               count(DISTINCT member_id) FILTER (WHERE owes) AS people
        FROM unpaid GROUP BY band
      ) x ON x.ord = b.ord
    ),
    'owed', (SELECT coalesce(sum(amount), 0) FROM unpaid WHERE owes),
    'per_due', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'expected', expected,
                                                   'collected', collected) ORDER BY expected DESC), '[]'::jsonb)
      FROM (SELECT d.name, sum(l.expected) AS expected, sum(l.collected) AS collected
            FROM due_lines l JOIN d ON d.id = l.due_id GROUP BY d.id, d.name) x
    ),
    'top_owing', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'owing', owing)
                                ORDER BY owing DESC, name), '[]'::jsonb)
      FROM (SELECT mem.id, mem.name, sum(u.amount) AS owing
            FROM unpaid u JOIN mem ON mem.id = u.member_id
            WHERE u.owes
            GROUP BY mem.id, mem.name ORDER BY owing DESC, mem.name LIMIT 10) o
    ),
    'spending', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('label', label, 'amount', amount) ORDER BY amount DESC), '[]'::jsonb)
      FROM (SELECT label, sum(amount) AS amount FROM ledger_entries
            WHERE org_id = (SELECT current_org_id()) AND kind = 'expense' AND entry_date BETWEEN _from AND _to
            GROUP BY label HAVING sum(amount) <> 0) s
    ),
    'channels', channel_totals(_from, _to),
    'members', jsonb_build_object(
      'active', (SELECT count(*) FROM mem),
      'never_paid', (
        SELECT count(*) FROM mem
        WHERE NOT EXISTS (SELECT 1 FROM due_payments p WHERE p.member_id = mem.id AND p.voided_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM contribution_payments p WHERE p.member_id = mem.id AND p.voided_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM brought_forward_payments p WHERE p.member_id = mem.id AND p.voided_at IS NULL)
      ),
      'joined', (
        SELECT count(*) FROM members m
        WHERE m.org_id = (SELECT current_org_id()) AND m.joined_on BETWEEN _from AND _to
          AND (_branch_id IS NULL OR m.branch_id = _branch_id)
          AND (_label IS NULL OR _label = ANY (m.tags))
      )
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Cancelling payments, reversing ledger lines, history and exports know the new tables
-- ---------------------------------------------------------------------------
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
  ELSIF _kind = 'pledge' THEN
    _table := 'pledge_payments';
    SELECT voided_at INTO _voided FROM public.pledge_payments
    WHERE id = _payment_id AND org_id = _org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF _voided IS NOT NULL THEN RAISE EXCEPTION 'This payment has already been cancelled.'; END IF;
    UPDATE public.pledge_payments
    SET voided_at = now(), voided_by = auth.uid(), void_reason = _reason_clean
    WHERE id = _payment_id;
  ELSIF _kind = 'brought_forward' THEN
    _table := 'brought_forward_payments';
    SELECT voided_at INTO _voided FROM public.brought_forward_payments
    WHERE id = _payment_id AND org_id = _org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF _voided IS NOT NULL THEN RAISE EXCEPTION 'This payment has already been cancelled.'; END IF;
    UPDATE public.brought_forward_payments
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
  IF _source IN ('due_payments', 'contribution_payments', 'pledge_payments', 'brought_forward_payments') THEN
    RAISE EXCEPTION 'This line comes from a payment. Cancel the payment instead.';
  END IF;

  PERFORM public._reverse_ledger_entry(_entry_id, _reason_clean);
END;
$$;

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
     AND (TG_OP = 'UPDATE'
          OR _row ->> 'source_table' IN ('due_payments', 'contribution_payments', 'pledge_payments',
                                          'brought_forward_payments')) THEN
    RETURN NULL;
  END IF;

  _org_id := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (_row ->> 'id')::uuid
                  ELSE (_row ->> 'org_id')::uuid END;
  IF _org_id IS NULL OR EXISTS (SELECT 1 FROM public.orgs_being_wiped WHERE org_id = _org_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_log (org_id, actor_id, actor_label, table_name, row_id, action, old_row, new_row)
  VALUES (_org_id, auth.uid(), public.support_actor_label(), TG_TABLE_NAME, (_row ->> 'id')::uuid,
          lower(TG_OP), _old, _new);
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_brought_forward_debts AFTER INSERT OR UPDATE OR DELETE ON public.brought_forward_debts
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_brought_forward_payments AFTER INSERT OR UPDATE OR DELETE ON public.brought_forward_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

CREATE OR REPLACE FUNCTION public.admin_export_org(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _out jsonb;
BEGIN
  PERFORM public.require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id) THEN
    RAISE EXCEPTION 'Organization not found.';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', now(),
    'organization', (SELECT to_jsonb(o) FROM public.organizations o WHERE o.id = _org_id),
    'team', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'user_id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'email', u.email,
                 'role', r.role)), '[]')
             FROM public.profiles p
             LEFT JOIN auth.users u ON u.id = p.id
             LEFT JOIN public.user_roles r ON r.user_id = p.id AND r.org_id = _org_id
             WHERE p.org_id = _org_id),
    'branches', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.branches t WHERE t.org_id = _org_id),
    'members', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.members t WHERE t.org_id = _org_id),
    'dues', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.dues t WHERE t.org_id = _org_id),
    'due_rates', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.due_rates t WHERE t.org_id = _org_id),
    'due_members', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.due_members t WHERE t.org_id = _org_id),
    'due_payments', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.due_payments t WHERE t.org_id = _org_id),
    'contributions', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.contributions t WHERE t.org_id = _org_id),
    'contribution_members', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.contribution_members t WHERE t.org_id = _org_id),
    'contribution_payments', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.contribution_payments t WHERE t.org_id = _org_id),
    'contribution_expenses', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.contribution_expenses t WHERE t.org_id = _org_id),
    'pledge_drives', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.pledge_drives t WHERE t.org_id = _org_id),
    'pledges', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.pledges t WHERE t.org_id = _org_id),
    'pledge_payments', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.pledge_payments t WHERE t.org_id = _org_id),
    'brought_forward_debts', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.brought_forward_debts t WHERE t.org_id = _org_id),
    'brought_forward_payments', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.brought_forward_payments t WHERE t.org_id = _org_id),
    'ledger_entries', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.ledger_entries t WHERE t.org_id = _org_id),
    'fiscal_years', (SELECT coalesce(jsonb_agg(t), '[]') FROM public.fiscal_years t WHERE t.org_id = _org_id),
    'history', (SELECT coalesce(jsonb_agg(t ORDER BY t.at), '[]') FROM public.audit_log t WHERE t.org_id = _org_id)
  ) INTO _out;

  PERFORM public.log_platform_action('export', _org_id, NULL);
  RETURN _out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.member_balances(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.member_balances(jsonb, uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.cancel_brought_forward_debt(uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.set_brought_forward_done(boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.member_balances(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.member_balances(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_brought_forward_debt(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_brought_forward_done(boolean) TO authenticated;

RESET lock_timeout;
