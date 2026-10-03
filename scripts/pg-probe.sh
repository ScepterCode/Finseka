#!/usr/bin/env bash
# TEMPORARY diagnostic for the faster-balances branch: times the balance functions on the CI
# Postgres (17, like production) and prints the plan of anything slow. Not for main.
set -u
URL="$1"            # e.g. postgresql://postgres:postgres@localhost:5432/postgres
BASE="${URL%/*}"
stamp() { while IFS= read -r l; do printf '%s %s\n' "$(date +%T)" "$l"; done; }

fresh_db() {        # $1 = database name: stub + every migration
  psql "$URL" -X -q -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" 2>/dev/null
  psql "$BASE/$1" -X -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase_stub.sql >/dev/null 2>&1
  for m in supabase/migrations/*.sql; do
    psql "$BASE/$1" -X -q -v ON_ERROR_STOP=1 -1 -f "$m" >/dev/null 2>&1 || { echo "migration failed: $m"; exit 1; }
  done
}

fresh_db probe
psql "$URL" -X -At -c "select version()"

# The balance test's data, committed (everything before its comparisons).
( cd supabase/tests
  sed -n '1,/^-- Same answers, on several days/p' 19_balances.test.sql > zz_probe_load.sql
  printf 'BEGIN;\n\\i zz_probe_load.sql\nCOMMIT;\n' | psql "$BASE/probe" -X -q -v ON_ERROR_STOP=1 >/dev/null 2>&1
  rm -f zz_probe_load.sql )
psql "$BASE/probe" -X -At -c "select 'loaded: ' || (select count(*) from due_payments) || ' payments, ' || (select count(*) from members) || ' members'"
psql "$BASE/probe" -X -q -f supabase/tests/reference_analytics.sql >/dev/null 2>&1

session() {         # $1 = today, $2 = SQL; prints timings and auto_explain plans of slow statements
  psql "$BASE/probe" -X -q 2>&1 <<SQL
LOAD 'auto_explain';
SET auto_explain.log_min_duration = 2000;
SET auto_explain.log_analyze = on;
SET auto_explain.log_nested_statements = on;
SET auto_explain.log_level = notice;
BEGIN;
SELECT set_config('finseka.today', '$1', true) AS a,
       set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true) AS b \gset
SET LOCAL ROLE authenticated;
SET LOCAL statement_timeout = '90s';
\timing on
$2;
ROLLBACK;
SQL
}
timed() { session "$2" "$3" | grep -E "Time:|ERROR|canceling" | sed "s/^/[$1 @ $2] /" | stamp; }
plans() { session "$2" "$3" | grep -vE "^\s*$|Buffers|Storage" | head -150 | sed "s/^/[$1 plan] /"; }

for day in 2024-02-20 2025-12-31 2026-10-01; do
  timed "old standing_lines" $day "SELECT count(*), sum(short + penalty) FROM standing_lines()"
  timed "new member_balances" $day "SELECT count(*), sum(total_owing) FROM member_balances()"
  timed "new current_period_dues" $day "SELECT * FROM current_period_dues()"
  timed "new dashboard" $day "SELECT length(dashboard_summary()::text)"
  timed "old analytics" $day "SELECT length(tests.analytics_reference(('$day'::date - 365), '$day'::date)::text)"
  timed "new analytics" $day "SELECT length(analytics_summary(('$day'::date - 365), '$day'::date)::text)"
done

echo "=== plans of anything over 2 s (today 2026-10-01)"
plans "new member_balances" 2026-10-01 "SELECT count(*) FROM member_balances()"
plans "new dashboard" 2026-10-01 "SELECT length(dashboard_summary()::text)"
plans "new analytics" 2026-10-01 "SELECT length(analytics_summary('2025-10-01', '2026-10-01')::text)"

echo "=== the balance test itself, step by step (5-minute limit), in a fresh database"
fresh_db probe2
( cd supabase/tests
  printf 'BEGIN;\n\\i 19_balances.test.sql\nROLLBACK;\n' \
    | timeout 300 psql "$BASE/probe2" -X -q -v ON_ERROR_STOP=1 2>&1 \
    | grep -E "NOTICE|ERROR" | stamp ) || echo "(stopped)"
exit 0
