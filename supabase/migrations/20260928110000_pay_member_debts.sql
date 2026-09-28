-- PAY FROM THE MEMBER PROFILE
-- One payment is applied to the member's oldest debts first: due periods in date order,
-- then compulsory contributions. Each part becomes an ordinary payment row (so the
-- ledger, history and totals work as usual). A late charge clears once its period is paid.

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
    ORDER BY coalesce(period_start, '9999-12-31'::date), kind DESC, ref_name
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

REVOKE ALL ON FUNCTION public.pay_member_debts(uuid, numeric, date, public.payment_channel, text, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pay_member_debts(uuid, numeric, date, public.payment_channel, text, text, uuid) TO authenticated;
