-- PLEDGES AND GIFTS, AND MORE MEMBER DETAILS
--
-- Pledges are promises of money. They are never a debt: they do not appear in what a
-- member owes. A pledge belongs either to a contribution that accepts pledges, or to a
-- standalone pledge drive. Anyone can pledge — a member, or someone outside the
-- organization identified by name, phone and address.
-- Redeeming a pledge (money actually received) is recorded like a payment: it has a
-- mode, reference and date, lands in the ledger, can be cancelled (and is then reversed),
-- and respects closed financial years.

-- ---------------------------------------------------------------------------
-- Member details (all optional)
-- ---------------------------------------------------------------------------
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS next_of_kin_name text,
  ADD COLUMN IF NOT EXISTS next_of_kin_phone text;

ALTER TABLE public.members
  ADD CONSTRAINT members_gender_known CHECK (gender IS NULL OR gender IN ('female', 'male')),
  ADD CONSTRAINT members_email_shape CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD CONSTRAINT members_birth_date_sane CHECK (date_of_birth IS NULL OR date_of_birth BETWEEN '1900-01-01' AND '2100-01-01'),
  ADD CONSTRAINT members_details_length CHECK (
    coalesce(length(email), 0) <= 200 AND coalesce(length(address), 0) <= 500
    AND coalesce(length(occupation), 0) <= 200 AND coalesce(length(next_of_kin_name), 0) <= 200
    AND coalesce(length(next_of_kin_phone), 0) <= 50);
GRANT UPDATE (email, gender, date_of_birth, address, occupation, next_of_kin_name, next_of_kin_phone)
  ON public.members TO authenticated;

-- ---------------------------------------------------------------------------
-- Contributions may accept pledges
-- ---------------------------------------------------------------------------
ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS accepts_pledges boolean NOT NULL DEFAULT false;
GRANT UPDATE (accepts_pledges) ON public.contributions TO authenticated;

-- ---------------------------------------------------------------------------
-- Pledge drives: a standalone appeal for pledges and gifts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pledge_drives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  target_amount numeric(14,2) CHECK (target_amount IS NULL OR target_amount >= 0),
  closes_on date,
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pledge_drives_org_idx ON public.pledge_drives (org_id);

-- ---------------------------------------------------------------------------
-- Pledges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pledges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  drive_id uuid REFERENCES public.pledge_drives(id) ON DELETE RESTRICT,
  contribution_id uuid REFERENCES public.contributions(id) ON DELETE RESTRICT,
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  pledger_name text NOT NULL,
  pledger_phone text,
  pledger_address text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  pledged_on date NOT NULL DEFAULT public.org_today(),
  promised_by date,
  note text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pledges_for_one_thing CHECK (num_nonnulls(drive_id, contribution_id) = 1),
  CONSTRAINT pledges_name_present CHECK (length(trim(pledger_name)) > 0),
  CONSTRAINT pledges_details_length CHECK (
    length(pledger_name) <= 200 AND coalesce(length(pledger_phone), 0) <= 50
    AND coalesce(length(pledger_address), 0) <= 500 AND coalesce(length(note), 0) <= 500)
);
CREATE INDEX IF NOT EXISTS pledges_org_idx ON public.pledges (org_id, pledged_on DESC);
CREATE INDEX IF NOT EXISTS pledges_drive_idx ON public.pledges (drive_id);
CREATE INDEX IF NOT EXISTS pledges_contribution_idx ON public.pledges (contribution_id);
CREATE INDEX IF NOT EXISTS pledges_member_idx ON public.pledges (member_id);

-- ---------------------------------------------------------------------------
-- Redemptions: money received against a pledge
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pledge_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pledge_id uuid NOT NULL REFERENCES public.pledges(id) ON DELETE RESTRICT,
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
CREATE INDEX IF NOT EXISTS pledge_payments_pledge_idx ON public.pledge_payments (pledge_id);

-- ---------------------------------------------------------------------------
-- Access: everyone in the organization reads; admins write.
-- Redemptions are add-only from the app (cancelling goes through void_payment).
-- ---------------------------------------------------------------------------
ALTER TABLE public.pledge_drives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pledges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pledge_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pledge_drives, public.pledges, public.pledge_payments FROM anon, public;
GRANT SELECT, INSERT, DELETE ON public.pledge_drives TO authenticated;
GRANT UPDATE (name, description, target_amount, closes_on, closed) ON public.pledge_drives TO authenticated;
-- A pledge keeps who made it and what it is for; cancelling goes through cancel_pledge.
-- It can only be deleted while nothing has been redeemed (the foreign key refuses otherwise).
GRANT SELECT, INSERT, DELETE ON public.pledges TO authenticated;
GRANT UPDATE (pledger_name, pledger_phone, pledger_address, amount, promised_by, note)
  ON public.pledges TO authenticated;
GRANT SELECT, INSERT ON public.pledge_payments TO authenticated;
GRANT ALL ON public.pledge_drives, public.pledges, public.pledge_payments TO service_role;

CREATE POLICY pledge_drives_select ON public.pledge_drives
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY pledge_drives_write ON public.pledge_drives
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY pledges_select ON public.pledges
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY pledges_write ON public.pledges
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());

CREATE POLICY pledge_payments_select ON public.pledge_payments
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY pledge_payments_insert ON public.pledge_payments
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin()
              AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL);

-- ---------------------------------------------------------------------------
-- Pledge checks: same organization, contribution accepts pledges, member details
-- filled in, amount never below what has been redeemed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_pledge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _m record;
  _accepts boolean;
  _redeemed numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A new pledge is always open; cancelling goes through cancel_pledge.
    NEW.cancelled_at := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancel_reason := NULL;
  END IF;
  IF NEW.drive_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pledge_drives WHERE id = NEW.drive_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'Pledge drive not found.';
  END IF;
  IF NEW.contribution_id IS NOT NULL THEN
    SELECT accepts_pledges INTO _accepts FROM contributions
    WHERE id = NEW.contribution_id AND org_id = NEW.org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contribution not found.';
    END IF;
    IF NOT _accepts AND (TG_OP = 'INSERT' OR NEW.contribution_id IS DISTINCT FROM OLD.contribution_id) THEN
      RAISE EXCEPTION 'This contribution does not take pledges. Turn on pledges for it first.';
    END IF;
  END IF;

  IF NEW.member_id IS NOT NULL THEN
    SELECT name, phone, address INTO _m FROM members WHERE id = NEW.member_id AND org_id = NEW.org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Member not found.';
    END IF;
    NEW.pledger_name := coalesce(nullif(trim(coalesce(NEW.pledger_name, '')), ''), _m.name);
    NEW.pledger_phone := coalesce(nullif(trim(coalesce(NEW.pledger_phone, '')), ''), _m.phone);
    NEW.pledger_address := coalesce(nullif(trim(coalesce(NEW.pledger_address, '')), ''), _m.address);
  END IF;
  NEW.pledger_name := trim(coalesce(NEW.pledger_name, ''));
  NEW.pledger_phone := nullif(trim(coalesce(NEW.pledger_phone, '')), '');
  NEW.pledger_address := nullif(trim(coalesce(NEW.pledger_address, '')), '');

  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id <> OLD.org_id THEN
      RAISE EXCEPTION 'A pledge cannot move to another organization.';
    END IF;
    IF NEW.amount < OLD.amount THEN
      SELECT coalesce(sum(amount), 0) INTO _redeemed FROM pledge_payments
      WHERE pledge_id = NEW.id AND voided_at IS NULL;
      IF NEW.amount < _redeemed THEN
        RAISE EXCEPTION 'The pledge cannot be less than what has already been redeemed (₦%).',
          to_char(_redeemed, 'FM999,999,999,990.##');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_pledge() FROM anon, public, authenticated;

CREATE TRIGGER pledges_check BEFORE INSERT OR UPDATE ON public.pledges
  FOR EACH ROW EXECUTE FUNCTION public.check_pledge();

-- A redemption must belong to an open pledge and never take it past what was promised.
CREATE OR REPLACE FUNCTION public.check_pledge_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  _redeemed numeric;
BEGIN
  SELECT * INTO p FROM pledges WHERE id = NEW.pledge_id AND org_id = NEW.org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pledge not found.';
  END IF;
  IF p.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This pledge was cancelled.';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO _redeemed FROM pledge_payments
  WHERE pledge_id = NEW.pledge_id AND voided_at IS NULL;
  IF _redeemed + NEW.amount > p.amount THEN
    RAISE EXCEPTION 'That is more than is left on the pledge (₦%).',
      to_char(p.amount - _redeemed, 'FM999,999,999,990.##');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_pledge_payment() FROM anon, public, authenticated;

-- "a_" runs first (method and channel in step), then the pledge check, then the year lock.
CREATE TRIGGER a_pledge_payments_sync_channel BEFORE INSERT OR UPDATE ON public.pledge_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_payment_channel();
CREATE TRIGGER b_pledge_payments_check BEFORE INSERT ON public.pledge_payments
  FOR EACH ROW EXECUTE FUNCTION public.check_pledge_payment();
CREATE TRIGGER closed_year_pledge_payments BEFORE INSERT OR UPDATE ON public.pledge_payments
  FOR EACH ROW EXECUTE FUNCTION public.refuse_closed_year('paid_at');

-- Each redemption becomes one "money in" ledger line.
CREATE OR REPLACE FUNCTION public.sync_pledge_payment_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  _for text;
  _redeemed numeric;
  _desc text;
BEGIN
  SELECT * INTO p FROM pledges WHERE id = NEW.pledge_id;
  SELECT coalesce(
    (SELECT name FROM pledge_drives WHERE id = p.drive_id),
    (SELECT name FROM contributions WHERE id = p.contribution_id),
    'a pledge') INTO _for;
  SELECT coalesce(sum(amount), 0) INTO _redeemed FROM pledge_payments
  WHERE pledge_id = p.id AND voided_at IS NULL;

  _desc := p.pledger_name || ' redeemed a pledge for ' || _for;
  IF _redeemed < p.amount THEN
    _desc := _desc || ' — part';
  ELSIF NEW.amount < p.amount THEN
    _desc := _desc || ' — balance';
  END IF;

  INSERT INTO ledger_entries (org_id, kind, label, description, amount, entry_date, source_table, source_id, member_id, method, channel, reference)
  VALUES (NEW.org_id, 'income', 'Pledge', _desc, NEW.amount, NEW.paid_at, 'pledge_payments', NEW.id, p.member_id, NEW.method, NEW.channel, NEW.reference);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_pledge_payment_ledger() FROM anon, public, authenticated;

CREATE TRIGGER pledge_payments_ledger AFTER INSERT ON public.pledge_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_pledge_payment_ledger();

-- ---------------------------------------------------------------------------
-- Where each pledge stands
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.pledge_status
WITH (security_invoker = true)
AS
SELECT p.id, p.org_id, p.drive_id, p.contribution_id, p.member_id,
       p.pledger_name, p.pledger_phone, p.pledger_address,
       p.amount, p.pledged_on, p.promised_by, p.note,
       p.cancelled_at, p.cancel_reason, p.created_at,
       coalesce(r.redeemed, 0)::numeric(14,2) AS redeemed,
       CASE WHEN p.cancelled_at IS NOT NULL THEN 0
            ELSE greatest(p.amount - coalesce(r.redeemed, 0), 0) END::numeric(14,2) AS outstanding,
       r.last_paid_at,
       CASE WHEN p.cancelled_at IS NOT NULL THEN 'cancelled'
            WHEN coalesce(r.redeemed, 0) >= p.amount THEN 'redeemed'
            WHEN coalesce(r.redeemed, 0) > 0 THEN 'part'
            ELSE 'open' END AS status,
       coalesce(d.name, c.name) AS for_name
FROM public.pledges p
LEFT JOIN LATERAL (
  SELECT sum(amount) AS redeemed, max(paid_at) AS last_paid_at
  FROM public.pledge_payments pp
  WHERE pp.pledge_id = p.id AND pp.voided_at IS NULL
) r ON true
LEFT JOIN public.pledge_drives d ON d.id = p.drive_id
LEFT JOIN public.contributions c ON c.id = p.contribution_id;

REVOKE ALL ON public.pledge_status FROM anon, public;
GRANT SELECT ON public.pledge_status TO authenticated;

-- ---------------------------------------------------------------------------
-- Cancelling: redemptions can be cancelled like other payments; pledge lines in the
-- ledger are reversed by cancelling the redemption, not directly.
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
  IF _source IN ('due_payments', 'contribution_payments', 'pledge_payments') THEN
    RAISE EXCEPTION 'This line comes from a payment. Cancel the payment instead.';
  END IF;

  PERFORM public._reverse_ledger_entry(_entry_id, _reason_clean);
END;
$$;

-- Cancel a pledge: the promise is withdrawn. Money already redeemed stays recorded.
CREATE OR REPLACE FUNCTION public.cancel_pledge(_pledge_id uuid, _reason text)
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
    RAISE EXCEPTION 'Say why this pledge is being cancelled.';
  END IF;
  UPDATE public.pledges
  SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = _reason_clean
  WHERE id = _pledge_id AND org_id = _org_id AND cancelled_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pledge not found, or already cancelled.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.void_payment(text, uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.reverse_ledger_entry(uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.cancel_pledge(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.void_payment(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_ledger_entry(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pledge(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- History: log the new tables; ledger lines made by redemptions mirror the redemption.
-- ---------------------------------------------------------------------------
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
          OR _row ->> 'source_table' IN ('due_payments', 'contribution_payments', 'pledge_payments')) THEN
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

CREATE TRIGGER audit_pledge_drives AFTER INSERT OR UPDATE OR DELETE ON public.pledge_drives
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_pledges AFTER INSERT OR UPDATE OR DELETE ON public.pledges
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_pledge_payments AFTER INSERT OR UPDATE OR DELETE ON public.pledge_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
