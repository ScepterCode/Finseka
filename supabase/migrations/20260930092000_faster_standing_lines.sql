-- FASTER BALANCES. standing_lines is behind the dashboard, member balances, reports,
-- analytics and the financial-year summary. For a 500-member organization with a daily due
-- these took 30-65 s; Supabase stops signed-in users' queries after 8 s. Two causes:
--
-- 1. Postgres folded the "p" step (every period of every due, with its price) into the main
--    query, so due_amount_for() ran for every member x period, several times per row: about
--    600,000 price lookups where 397 would do. MATERIALIZED makes it price each period once.
--    (30 s -> 3 s with dues that apply to everyone.)
-- 2. due_applies_to() asks "has this member paid anything towards this due?" for members
--    outside a due's audience (a label, branch or chosen people). No index covered due+member,
--    so each check read all of the due's payments. (65 s -> 6.5 s with such dues.)
--
-- The function is otherwise exactly as 20260928100000_due_audience.sql left it and the index
-- only speeds up lookups, so every figure is unchanged (checked on load-test data, and by the
-- totals tests). Only "p" is materialized: materializing "dm" too made Postgres misjudge row
-- counts and pick a plan that ran for over 10 minutes.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS due_payments_due_member_idx
  ON public.due_payments (due_id, member_id) WHERE voided_at IS NULL;

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
$$;

RESET lock_timeout;
