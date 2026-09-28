-- WHO PAYS A DUE
-- A due can apply to everyone (as before), to members with certain labels, to members in
-- certain branches, or to specific people. It is "live": whoever matches now owes. Anyone
-- who has already paid something towards the due stays on it, so taking a label away
-- never hides a part-paid debt.

CREATE TYPE public.due_audience AS ENUM ('everyone', 'labels', 'branches', 'people');

ALTER TABLE public.dues
  ADD COLUMN IF NOT EXISTS audience public.due_audience NOT NULL DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS audience_labels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience_branch_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.dues
  ADD CONSTRAINT dues_audience_labels_present CHECK (audience <> 'labels' OR cardinality(audience_labels) > 0),
  ADD CONSTRAINT dues_audience_branches_present CHECK (audience <> 'branches' OR cardinality(audience_branch_ids) > 0);
GRANT UPDATE (audience, audience_labels, audience_branch_ids) ON public.dues TO authenticated;

-- The people a due applies to, when it is for specific people.
CREATE TABLE IF NOT EXISTS public.due_members (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  due_id uuid NOT NULL REFERENCES public.dues(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  PRIMARY KEY (due_id, member_id)
);
ALTER TABLE public.due_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.due_members TO authenticated;
GRANT ALL ON public.due_members TO service_role;
CREATE POLICY due_members_select ON public.due_members
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY due_members_write ON public.due_members
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_admin());
DROP TRIGGER IF EXISTS audit_due_members ON public.due_members;
CREATE TRIGGER audit_due_members AFTER INSERT OR UPDATE OR DELETE ON public.due_members
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- Does this due apply to this member?
CREATE OR REPLACE FUNCTION public.due_applies_to(
  _due_id uuid, _audience public.due_audience, _labels text[], _branch_ids uuid[],
  _member_id uuid, _tags text[], _branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT _audience = 'everyone'
      OR (_audience = 'labels' AND _tags && _labels)
      OR (_audience = 'branches' AND _branch_id = ANY (_branch_ids))
      OR (_audience = 'people' AND EXISTS (
            SELECT 1 FROM due_members WHERE due_id = _due_id AND member_id = _member_id))
      -- anyone who has paid something towards it stays on it
      OR EXISTS (SELECT 1 FROM due_payments
                 WHERE due_id = _due_id AND member_id = _member_id AND voided_at IS NULL)
$$;

-- For the due's page: the active members it applies to (one array, so no row limit).
CREATE OR REPLACE FUNCTION public.due_member_ids(_due_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(m.id), '{}')
  FROM dues d
  JOIN members m ON m.org_id = d.org_id AND m.active
  WHERE d.id = _due_id AND d.org_id = current_org_id()
    AND due_applies_to(d.id, d.audience, d.audience_labels, d.audience_branch_ids, m.id, m.tags, m.branch_id)
$$;

-- ---------------------------------------------------------------------------
-- Who owes what, now respecting who each due is for. Compulsory contributions carry
-- their creation date (period_start) and due date (period_end) for the member statement.
-- ---------------------------------------------------------------------------
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
  p AS (
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

REVOKE ALL ON FUNCTION public.due_applies_to(uuid, public.due_audience, text[], uuid[], uuid, text[], uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.due_member_ids(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.standing_lines(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.due_applies_to(uuid, public.due_audience, text[], uuid[], uuid, text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.due_member_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.standing_lines(uuid) TO authenticated;
