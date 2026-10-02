-- The faster totals (member_balances, dashboard, analytics) must give exactly the same answers as
-- adding up standing_lines(), the period-by-period truth, on deliberately awkward data and on
-- several different "today"s.
\ir fixtures.sql
RESET ROLE;
\ir reference_analytics.sql

-- ---------------------------------------------------------------------------
-- Awkward data for Org Two (written as server code, so every trigger runs as in the app)
-- ---------------------------------------------------------------------------
SELECT setseed(0.31);
SET LOCAL finseka.today = '2026-10-01';

INSERT INTO branches (org_id, name) VALUES (:'org2', 'Aba'), (:'org2', 'Owerri');
SELECT min(id::text)::uuid AS br FROM branches WHERE org_id = :'org2' AND name = 'Aba' \gset

-- 30 members: joined at all sorts of dates (some after today), some in the choir, some inactive.
INSERT INTO members (org_id, name, joined_on, tags, branch_id, active)
SELECT :'org2', 'Member ' || g,
       '2023-06-01'::date + (random() * 1250)::int,
       CASE WHEN random() < 0.35 THEN ARRAY['choir'] ELSE '{}' END,
       CASE WHEN random() < 0.5 THEN :'br'::uuid END,
       random() > 0.08
FROM generate_series(1, 30) g;

INSERT INTO dues (org_id, name, amount, frequency, starts_on, penalty_amount, penalty_grace_days, audience,
                  audience_labels, audience_branch_ids, active)
VALUES (:'org2', 'Monthly', 1000, 'monthly', '2024-01-15', 200, 5, 'everyone', '{}', '{}', true),
       (:'org2', 'Weekly', 300, 'weekly', '2025-02-05', 50, 0, 'everyone', '{}', '{}', true),
       (:'org2', 'Daily', 100, 'daily', '2026-09-15', 0, 0, 'everyone', '{}', '{}', true),
       (:'org2', 'Yearly levy', 12000, 'yearly', '2023-03-01', 1000, 30, 'everyone', '{}', '{}', true),
       (:'org2', 'Building (one-off)', 25000, 'custom', '2025-01-01', 0, 0, 'everyone', '{}', '{}', true),
       (:'org2', 'Choir weekly', 150, 'weekly', '2025-06-02', 20, 3, 'labels', ARRAY['choir'], '{}', true),
       (:'org2', 'Aba monthly', 700, 'monthly', '2024-09-01', 100, 0, 'branches', '{}', ARRAY[:'br'::uuid], true),
       (:'org2', 'Chosen people', 2000, 'monthly', '2025-03-01', 0, 0, 'people', '{}', '{}', true),
       (:'org2', 'Starts next year', 500, 'monthly', '2027-01-01', 0, 0, 'everyone', '{}', '{}', true),
       (:'org2', 'Stopped', 400, 'monthly', '2024-01-01', 50, 0, 'everyone', '{}', '{}', false);

-- Price changes.
INSERT INTO due_rates (org_id, due_id, amount, effective_from)
SELECT :'org2', id, 1500, '2025-06-01' FROM dues WHERE org_id = :'org2' AND name = 'Monthly';
INSERT INTO due_rates (org_id, due_id, amount, effective_from)
SELECT :'org2', id, 120, '2026-09-25' FROM dues WHERE org_id = :'org2' AND name = 'Daily';

-- A third of the members are the chosen people.
INSERT INTO due_members (org_id, due_id, member_id)
SELECT :'org2', d.id, m.id FROM dues d JOIN members m ON m.org_id = d.org_id
WHERE d.org_id = :'org2' AND d.name = 'Chosen people' AND random() < 0.33;

-- Payments for every kind of period: in full, part, over; before joining; in advance; and some
-- by members a due does not apply to (paying keeps them on it).
INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, paid_at, method)
SELECT :'org2', d.id, m.id, x.period_start,
       CASE WHEN r < 0.55 THEN e WHEN r < 0.75 THEN round(e * 0.4) WHEN r < 0.8 THEN e * 2 ELSE e END,
       least(x.period_start, '2026-09-30'::date), 'cash'
FROM dues d
JOIN members m ON m.org_id = d.org_id
CROSS JOIN LATERAL due_periods(d.frequency, d.starts_on, '2026-11-15') x
CROSS JOIN LATERAL (SELECT random() AS r, due_amount_for(d.id, x.period_start) AS e) v
WHERE d.org_id = :'org2' AND d.active AND r < 0.85
  AND (d.frequency <> 'daily' OR random() < 0.4);

-- Void some, and pay twice for some periods.
UPDATE due_payments SET voided_at = now(), void_reason = 'Wrong member'
WHERE org_id = :'org2' AND id IN (SELECT id FROM due_payments WHERE org_id = :'org2' ORDER BY random() LIMIT 40);
INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, paid_at, method)
SELECT org_id, due_id, member_id, period_start, 100, paid_at, 'cash'
FROM due_payments WHERE org_id = :'org2' AND voided_at IS NULL ORDER BY random() LIMIT 60;

-- Compulsory and freewill contributions, part-paid.
INSERT INTO contributions (org_id, name, amount_per_person, mandatory, due_date)
VALUES (:'org2', 'Burial', 5000, true, '2026-08-01'), (:'org2', 'Projector', 3000, true, '2026-12-01'),
       (:'org2', 'Freewill', 0, false, NULL);
INSERT INTO contribution_members (org_id, contribution_id, member_id)
SELECT :'org2', c.id, m.id FROM contributions c JOIN members m ON m.org_id = c.org_id
WHERE c.org_id = :'org2' AND random() < 0.7;
INSERT INTO contribution_payments (org_id, contribution_id, member_id, amount, paid_at, method)
SELECT :'org2', cm.contribution_id, cm.member_id, (1000 + random() * 5000)::int, '2026-07-01', 'cash'
FROM contribution_members cm WHERE cm.org_id = :'org2' AND random() < 0.6;

-- Measure the freshly loaded tables, as Postgres does on its own shortly after a load. (The old
-- standing_lines() reference is slow without it.)
ANALYZE members, dues, due_rates, due_members, due_payments, contributions, contribution_members,
        contribution_payments;

-- ---------------------------------------------------------------------------
-- Same answers, on several days
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE days (today date);
INSERT INTO days VALUES ('2026-10-01'), ('2026-03-15'), ('2025-12-31'), ('2025-06-01'), ('2024-02-20');
GRANT SELECT ON days TO authenticated;

SET LOCAL ROLE authenticated;
SELECT tests.as_user(:bola) \gset

CREATE FUNCTION pg_temp.balance_differences() RETURNS bigint LANGUAGE sql AS $$
  WITH ref AS (
    SELECT m.id, m.name,
           coalesce(sum(l.short) FILTER (WHERE l.kind = 'due'), 0),
           coalesce(sum(l.penalty), 0),
           coalesce(sum(l.short) FILTER (WHERE l.kind = 'contribution'), 0),
           coalesce(sum(l.short + l.penalty), 0)
    FROM members m LEFT JOIN standing_lines() l ON l.member_id = m.id
    WHERE m.org_id = current_org_id() AND m.active
    GROUP BY m.id, m.name)
  SELECT (SELECT count(*) FROM (SELECT * FROM ref EXCEPT SELECT * FROM member_balances()) a)
       + (SELECT count(*) FROM (SELECT * FROM member_balances() EXCEPT SELECT * FROM ref) b)
$$;

CREATE FUNCTION pg_temp.dashboard_differences() RETURNS text LANGUAGE sql AS $$
  WITH lines AS (SELECT * FROM standing_lines()),
  cur AS (SELECT * FROM lines WHERE kind = 'due' AND is_current),
  ref AS (SELECT (SELECT coalesce(sum(short + penalty), 0) FROM lines) AS owed,
                 (SELECT count(*) FROM cur WHERE paid >= expected) AS paid,
                 (SELECT count(*) FROM cur WHERE paid < expected) AS unpaid),
  got AS (SELECT dashboard_summary() AS j)
  SELECT nullif(concat_ws(' ',
    CASE WHEN (got.j ->> 'owed')::numeric IS DISTINCT FROM ref.owed THEN 'owed' END,
    CASE WHEN (got.j ->> 'dues_paid')::bigint IS DISTINCT FROM ref.paid THEN 'dues_paid' END,
    CASE WHEN (got.j ->> 'dues_unpaid')::bigint IS DISTINCT FROM ref.unpaid THEN 'dues_unpaid' END), '')
  FROM ref, got
$$;

-- Which analytics fields differ from the original (per_due compared as a set: equal amounts can come in any order).
-- (Each version is called once into a variable: in a plain query Postgres may call them again per field.)
CREATE FUNCTION pg_temp.analytics_differences(_from date, _to date, _branch uuid, _label text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  _new jsonb := analytics_summary(_from, _to, _branch, _label);
  _ref jsonb := tests.analytics_reference(_from, _to, _branch, _label);
BEGIN
  RETURN (
    SELECT string_agg(k, ',')
    FROM jsonb_object_keys(_ref) k
    WHERE CASE WHEN k = 'per_due'
               THEN (SELECT jsonb_agg(e ORDER BY e::text) FROM jsonb_array_elements(_new -> k) e)
                    IS DISTINCT FROM (SELECT jsonb_agg(e ORDER BY e::text) FROM jsonb_array_elements(_ref -> k) e)
               ELSE _new -> k IS DISTINCT FROM _ref -> k END);
END;
$$;

DO $$
DECLARE _day date; _diff text; _n bigint;
BEGIN
  FOR _day IN SELECT today FROM days ORDER BY today LOOP
    PERFORM set_config('finseka.today', _day::text, true);
    _n := pg_temp.balance_differences();
    IF _n <> 0 THEN RAISE EXCEPTION 'FAIL member balances differ on %: % rows', _day, _n; END IF;
    _diff := pg_temp.dashboard_differences();
    IF _diff IS NOT NULL THEN RAISE EXCEPTION 'FAIL dashboard differs on %: %', _day, _diff; END IF;
    RAISE NOTICE 'ok   balances and dashboard match on %', _day;
  END LOOP;
END $$;

DO $$
DECLARE _day date; _diff text; _r record;
BEGIN
  FOR _day IN SELECT today FROM days WHERE today IN ('2025-12-31', '2026-10-01') ORDER BY today LOOP
    PERFORM set_config('finseka.today', _day::text, true);
    FOR _r IN SELECT * FROM (VALUES
        ((_day - interval '12 months')::date, _day, NULL::uuid, NULL::text),
        ('2025-01-01'::date, '2025-12-31'::date, NULL, NULL),
        ((_day - interval '6 months')::date, _day,
         (SELECT min(id::text)::uuid FROM branches WHERE org_id = current_org_id() AND name = 'Aba'), NULL),
        ('2024-01-01'::date, _day, NULL, 'choir')) v(f, t, b, l) LOOP
      _diff := pg_temp.analytics_differences(_r.f, _r.t, _r.b, _r.l);
      IF _diff IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL analytics differ on % (% to %, branch %, label %): %', _day, _r.f, _r.t, _r.b, _r.l, _diff;
      END IF;
    END LOOP;
    RAISE NOTICE 'ok   analytics match on % (all members, a year, a branch, the choir)', _day;
  END LOOP;
END $$;

-- One member at a time (the member profile), including an inactive member.
SET LOCAL finseka.today = '2026-10-01';
SELECT tests.eq('one member''s balance matches their lines',
  (SELECT count(*) FROM members m
   WHERE m.org_id = :'org2'
     AND (SELECT total_owing FROM member_balances(m.id))
         IS DISTINCT FROM (SELECT coalesce(sum(short + penalty), 0) FROM standing_lines(m.id))),
  0::bigint);

-- And the data is awkward enough to matter.
SELECT tests.eq('the test data has late charges, partial payments and owed contributions',
  (SELECT sum(penalties) > 0 AND sum(dues_owing) > 0 AND sum(contributions_owing) > 0 FROM member_balances()),
  true);
