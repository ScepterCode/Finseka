-- Times what each page asks the database for, signed in as Big Church's admin.
-- Each query runs 3 times; the middle time is reported. Results are hashed so Postgres
-- cannot skip work whose output is never read.
\set QUIET on
CREATE FUNCTION pg_temp.bench(_label text, _sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  _t timestamptz;
  _ms numeric[] := '{}';
  _out text;
BEGIN
  FOR i IN 1..3 LOOP
    _t := clock_timestamp();
    EXECUTE format('WITH q AS (%s) SELECT md5(coalesce(string_agg(q::text, ''|''), '''')) FROM q', _sql) INTO _out;
    _ms := _ms || round(extract(epoch FROM clock_timestamp() - _t) * 1000, 1);
    EXIT WHEN _ms[1] > 5000;  -- slow enough that one run tells the story
  END LOOP;
  RAISE NOTICE '%', format('%-44s %10s ms', _label,
    (SELECT x FROM unnest(_ms) x ORDER BY x OFFSET (cardinality(_ms) / 2) LIMIT 1));
END;
$$;

SELECT p.id AS uid, p.org_id AS org
FROM profiles p JOIN organizations o ON o.id = p.org_id WHERE o.name = 'Big Church' \gset
SELECT id AS member FROM members WHERE org_id = :'org' ORDER BY id LIMIT 1 \gset
SELECT id AS daily FROM dues WHERE org_id = :'org' AND name = 'Daily contribution' \gset
SELECT id AS monthly FROM dues WHERE org_id = :'org' AND name = 'Monthly dues' \gset
SELECT id AS project FROM contributions WHERE org_id = :'org' AND name = 'Project 5' \gset

BEGIN;
SELECT set_config('request.jwt.claim.sub', :'uid', true) AS ignore \gset
SET LOCAL ROLE authenticated;

-- Dashboard
SELECT pg_temp.bench('dashboard: dashboard_summary', 'SELECT dashboard_summary()');
SELECT pg_temp.bench('dashboard: ledger_totals', 'SELECT ledger_totals()');
SELECT pg_temp.bench('dashboard: contribution_progress', 'SELECT contribution_progress()');
-- Members
SELECT pg_temp.bench('members: first 1,000 rows', 'SELECT id, name FROM members ORDER BY name, id LIMIT 1000');
SELECT pg_temp.bench('members: member_balances (everyone)', 'SELECT * FROM member_balances()');
SELECT pg_temp.bench('member profile: standing_lines', format('SELECT * FROM standing_lines(%L::uuid)', :'member'));
SELECT pg_temp.bench('member profile: due payments', format('SELECT * FROM due_payments WHERE member_id = %L', :'member'));
-- Dues
SELECT pg_temp.bench('due page: daily due periods', format('SELECT * FROM due_period_list(%L::uuid)', :'daily'));
SELECT pg_temp.bench('due page: who the daily due applies to', format('SELECT due_member_ids(%L::uuid)', :'daily'));
SELECT pg_temp.bench('due page: first 1,000 monthly payments',
  format('SELECT id, member_id, amount FROM due_payments WHERE due_id = %L ORDER BY id LIMIT 1000', :'monthly'));
-- Contributions
SELECT pg_temp.bench('contribution page: first 1,000 payments',
  format('SELECT id, member_id, amount FROM contribution_payments WHERE contribution_id = %L ORDER BY id LIMIT 1000', :'project'));
-- Ledger, history, reports
SELECT pg_temp.bench('ledger: newest 50 entries', 'SELECT * FROM ledger_entries ORDER BY entry_date DESC, id DESC LIMIT 50');
SELECT pg_temp.bench('history: newest 50 audit rows', 'SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT 50');
SELECT pg_temp.bench('reports: report_summary (this year)',
  format('SELECT report_summary(%L::date, %L::date)', date_trunc('year', current_date)::date, current_date));
SELECT pg_temp.bench('analytics: last 12 months',
  format('SELECT analytics_summary(%L::date, %L::date)', (current_date - interval '12 months')::date, current_date));
SELECT pg_temp.bench('financial year: summary', format('SELECT financial_year_summary(%L::date)', current_date));

-- Saving: one due payment, through RLS and every trigger.
SELECT pg_temp.bench('save: record one due payment',
  format('INSERT INTO due_payments (org_id, due_id, member_id, amount, channel, paid_at)
          SELECT org_id, id, %L, 100, ''cash'', current_date FROM dues WHERE id = %L RETURNING id', :'member', :'daily'));
ROLLBACK;
