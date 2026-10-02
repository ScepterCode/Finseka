-- FASTER BALANCES: totals without listing every member × every period.
--
-- member_balances(), dashboard_summary() and financial_year_summary() added up standing_lines(),
-- which lists one line per member per period of every due: about 200,000 lines for a 500-member
-- organization with a daily due, rebuilt on every page load. They now work out the same figures
-- per due and per payment:
--
--   owed for a due = everything charged from the period the member joined in up to today
--                    − what they paid, capped at each period's price
--   late charges   = the due's late charge × (periods past their grace days with a price
--                    − those of them the member paid in full)
--
-- "Everything charged from period X on" and "late periods from X on" are running totals over the
-- due's periods, worked out once per due. Nothing is stored, so nothing can go out of date.
-- standing_lines() is unchanged: it still gives one member's period-by-period lines (profile,
-- statement), and the tests check these totals against it.

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
-- Row-by-row joins are only quick when Postgres knows the tables are tiny; right after a bulk
-- load (before it measures them) it can wrongly pick them and take a minute. Hash joins never do.
SET enable_nestloop = off
AS $$
  WITH t AS (SELECT org_today() AS today),
  m AS MATERIALIZED (
    SELECT id, name, joined_on, tags, branch_id FROM members
    WHERE org_id = current_org_id() AND ((_member_id IS NULL AND active) OR id = _member_id)
  ),
  d AS MATERIALIZED (
    SELECT id, frequency, starts_on, coalesce(penalty_amount, 0) AS penalty_amount,
           coalesce(penalty_grace_days, 0) AS grace, audience, audience_labels, audience_branch_ids
    FROM dues WHERE org_id = current_org_id() AND active
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
  paid AS MATERIALIZED (
    SELECT due_id, member_id, period_start, sum(amount) AS paid
    FROM due_payments
    WHERE org_id = current_org_id() AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY due_id, member_id, period_start
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
    SELECT dm.member_id, -least(paid.paid, p.expected),
           CASE WHEN p.late AND p.expected > 0 AND paid.paid >= p.expected THEN -dm.penalty_amount ELSE 0 END
    FROM paid
    JOIN dm ON dm.due_id = paid.due_id AND dm.member_id = paid.member_id
    JOIN p ON p.due_id = paid.due_id AND p.period_start = paid.period_start
    WHERE p.period_start >= dm.first_start
  ),
  due_totals AS (
    SELECT member_id, sum(short) AS short, sum(penalty) AS penalty FROM due_parts GROUP BY member_id
  ),
  cp AS (
    SELECT contribution_id, member_id, sum(amount) AS paid
    FROM contribution_payments
    WHERE org_id = current_org_id() AND voided_at IS NULL
      AND (_member_id IS NULL OR member_id = _member_id)
    GROUP BY contribution_id, member_id
  ),
  contribution_totals AS (
    SELECT cm.member_id, sum(greatest(c.amount_per_person - coalesce(cp.paid, 0), 0)) AS short
    FROM contribution_members cm
    JOIN contributions c ON c.id = cm.contribution_id AND c.mandatory
    JOIN m ON m.id = cm.member_id
    LEFT JOIN cp ON cp.contribution_id = c.id AND cp.member_id = cm.member_id
    WHERE c.org_id = current_org_id()
    GROUP BY cm.member_id
  )
  SELECT m.id, m.name,
         coalesce(dt.short, 0),
         coalesce(dt.penalty, 0),
         coalesce(ct.short, 0),
         coalesce(dt.short, 0) + coalesce(dt.penalty, 0) + coalesce(ct.short, 0)
  FROM m
  LEFT JOIN due_totals dt ON dt.member_id = m.id
  LEFT JOIN contribution_totals ct ON ct.member_id = m.id
$$;

-- This period's dues: who has paid in full and who has not (active members only).
CREATE OR REPLACE FUNCTION public.current_period_dues()
RETURNS TABLE (paid_count bigint, unpaid_count bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (SELECT org_today() AS today),
  cur AS MATERIALIZED (
    SELECT d.id, d.audience, d.audience_labels, d.audience_branch_ids, x.period_start, x.period_end,
           due_amount_for(d.id, x.period_start) AS expected
    FROM dues d, t,
         LATERAL (SELECT CASE WHEN d.frequency = 'custom' THEN d.starts_on
                              ELSE period_start_of(d.frequency, t.today) END AS period_start,
                         period_end_of(d.frequency, period_start_of(d.frequency, t.today)) AS period_end) x
    WHERE d.org_id = current_org_id() AND d.active
      AND (d.frequency = 'custom' OR d.starts_on <= t.today)
  ),
  lines AS (
    SELECT cur.expected,
           coalesce((SELECT sum(dp.amount) FROM due_payments dp
                     WHERE dp.due_id = cur.id AND dp.member_id = m.id AND dp.period_start = cur.period_start
                       AND dp.voided_at IS NULL), 0) AS paid
    FROM cur
    JOIN members m ON m.org_id = current_org_id() AND m.active
     AND (cur.period_end IS NULL OR cur.period_end >= m.joined_on)
     AND due_applies_to(cur.id, cur.audience, cur.audience_labels, cur.audience_branch_ids, m.id, m.tags, m.branch_id)
  )
  SELECT count(*) FILTER (WHERE paid >= expected), count(*) FILTER (WHERE paid < expected) FROM lines
$$;

CREATE OR REPLACE FUNCTION public.dashboard_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH cur AS (SELECT * FROM current_period_dues())
  SELECT ledger_totals() || jsonb_build_object(
    'owed', (SELECT coalesce(sum(total_owing), 0) FROM member_balances()),
    'member_count', (SELECT count(*) FROM members WHERE org_id = current_org_id() AND active),
    'dues_paid', (SELECT paid_count FROM cur),
    'dues_unpaid', (SELECT unpaid_count FROM cur),
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
                     (SELECT coalesce(sum(total_owing), 0) FROM member_balances())),
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

REVOKE ALL ON FUNCTION public.current_period_dues() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.current_period_dues() TO authenticated;

-- Analytics: the same figures as before, worked out per period and per payment.
-- * expected per period = its price × how many members it applies to that had joined by then
-- * how late unpaid money is depends only on its period, so each due's periods are split into the
--   four lateness bands and the running totals are taken within each band
-- * the ten members owing most come from the same per-member figures
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
-- Row-by-row joins are only quick when Postgres knows the tables are tiny; right after a bulk
-- load (before it measures them) it can wrongly pick them and take a minute. Hash joins never do.
SET enable_nestloop = off
AS $$
  WITH t AS (SELECT org_today() AS today),
  mem AS MATERIALIZED (
    SELECT id, name, joined_on, tags, branch_id FROM members
    WHERE org_id = current_org_id() AND active
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
    WHERE org_id = current_org_id() AND entry_date BETWEEN _from AND _to
    GROUP BY 1
  ),
  d AS MATERIALIZED (
    SELECT id, name, frequency, starts_on, coalesce(penalty_amount, 0) AS penalty_amount,
           coalesce(penalty_grace_days, 0) AS grace, audience, audience_labels, audience_branch_ids
    FROM dues WHERE org_id = current_org_id() AND active
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
  lines_paid AS MATERIALIZED (
    SELECT dm.due_id, dm.member_id, dm.penalty_amount, p.period_start, p.band, p.late, p.expected,
           least(x.paid, p.expected) AS covered, x.paid >= p.expected AS paid_in_full
    FROM (SELECT due_id, member_id, period_start, sum(amount) AS paid
          FROM due_payments WHERE org_id = current_org_id() AND voided_at IS NULL
            AND member_id IN (SELECT id FROM mem)
          GROUP BY due_id, member_id, period_start) x
    JOIN dm ON dm.due_id = x.due_id AND dm.member_id = x.member_id
    JOIN p ON p.due_id = x.due_id AND p.period_start = x.period_start
    WHERE p.period_start >= dm.first_start
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
    FROM contribution_payments WHERE org_id = current_org_id() AND voided_at IS NULL
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
    WHERE c.org_id = current_org_id() AND c.amount_per_person > coalesce(cp.paid, 0)
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
            WHERE org_id = current_org_id() AND kind = 'expense' AND entry_date BETWEEN _from AND _to
            GROUP BY label HAVING sum(amount) <> 0) s
    ),
    'channels', channel_totals(_from, _to),
    'members', jsonb_build_object(
      'active', (SELECT count(*) FROM mem),
      'never_paid', (
        SELECT count(*) FROM mem
        WHERE NOT EXISTS (SELECT 1 FROM due_payments p WHERE p.member_id = mem.id AND p.voided_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM contribution_payments p WHERE p.member_id = mem.id AND p.voided_at IS NULL)
      ),
      'joined', (
        SELECT count(*) FROM members m
        WHERE m.org_id = current_org_id() AND m.joined_on BETWEEN _from AND _to
          AND (_branch_id IS NULL OR m.branch_id = _branch_id)
          AND (_label IS NULL OR _label = ANY (m.tags))
      )
    )
  )
$$;
