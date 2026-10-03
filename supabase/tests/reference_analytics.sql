-- The original analytics_summary (20260928130000_analytics.sql), adding up standing_lines().
-- Kept only as a reference: 19_balances.test.sql checks the faster version gives the same answers.
-- Included with \ir, not run on its own.
CREATE OR REPLACE FUNCTION tests.analytics_reference(
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
  mem AS (
    SELECT id, name FROM members
    WHERE org_id = current_org_id() AND active
      AND (_branch_id IS NULL OR branch_id = _branch_id)
      AND (_label IS NULL OR _label = ANY (tags))
  ),
  lines AS (
    SELECT l.* FROM standing_lines() l JOIN mem ON mem.id = l.member_id
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
  -- Dues charged for periods starting in the range, and how much of that was paid.
  due_lines AS (
    SELECT * FROM lines WHERE kind = 'due' AND period_start BETWEEN _from AND _to
  ),
  collection AS (
    SELECT date_trunc('month', period_start)::date AS m,
           sum(expected) AS expected, sum(least(paid, expected)) AS collected
    FROM due_lines GROUP BY 1
  ),
  unpaid AS (
    SELECT member_id, short + penalty AS amount,
           CASE
             WHEN kind = 'due' AND period_end IS NOT NULL AND period_end < t.today THEN t.today - period_end
             WHEN kind = 'contribution' AND period_end IS NOT NULL AND period_end < t.today THEN t.today - period_end
             ELSE 0
           END AS days_late
    FROM lines, t
    WHERE short + penalty > 0
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
      'collected', (SELECT coalesce(sum(least(paid, expected)), 0) FROM due_lines)
    ),
    'aging', (
      SELECT jsonb_agg(jsonb_build_object('bucket', b.name, 'amount', coalesce(x.amount, 0),
                                          'people', coalesce(x.people, 0)) ORDER BY b.ord)
      FROM (VALUES (1, 'Not yet late'), (2, 'Up to 1 month late'), (3, '1–3 months late'),
                   (4, 'Over 3 months late')) AS b(ord, name)
      LEFT JOIN (
        SELECT CASE WHEN days_late = 0 THEN 1 WHEN days_late <= 30 THEN 2
                    WHEN days_late <= 90 THEN 3 ELSE 4 END AS ord,
               sum(amount) AS amount, count(DISTINCT member_id) AS people
        FROM unpaid GROUP BY 1
      ) x ON x.ord = b.ord
    ),
    'owed', (SELECT coalesce(sum(amount), 0) FROM unpaid),
    'per_due', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', ref_name, 'expected', expected,
                                                   'collected', collected) ORDER BY expected DESC), '[]'::jsonb)
      FROM (SELECT ref_name, sum(expected) AS expected, sum(least(paid, expected)) AS collected
            FROM due_lines GROUP BY ref_id, ref_name) d
    ),
    'top_owing', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'owing', owing)
                                ORDER BY owing DESC, name), '[]'::jsonb)
      FROM (SELECT mem.id, mem.name, sum(u.amount) AS owing
            FROM unpaid u JOIN mem ON mem.id = u.member_id
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
GRANT EXECUTE ON FUNCTION tests.analytics_reference(date, date, uuid, text) TO authenticated;
