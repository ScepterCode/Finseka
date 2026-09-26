-- Changing who a contribution is for after it was created.
\ir fixtures.sql
SELECT tests.as_user(:bola) \gset

INSERT INTO members (org_id, name, joined_on) VALUES (:'org2', 'Ada M', '2026-01-01') RETURNING id AS ada_m \gset
INSERT INTO members (org_id, name, joined_on) VALUES (:'org2', 'Late Joiner', '2026-01-01') RETURNING id AS late \gset
INSERT INTO contributions (org_id, name, amount_per_person, mandatory)
VALUES (:'org2', 'Burial', 2000, true) RETURNING id AS c \gset
INSERT INTO contribution_members (org_id, contribution_id, member_id) VALUES (:'org2', :'c', :'ada_m');
INSERT INTO contribution_payments (org_id, contribution_id, member_id, amount) VALUES (:'org2', :'c', :'ada_m', 500);

-- Adding someone later makes them owe
INSERT INTO contribution_members (org_id, contribution_id, member_id) VALUES (:'org2', :'c', :'late');
SELECT tests.eq('someone added later owes the full amount',
  (SELECT contributions_owing FROM member_balances(:'late'::uuid)), 2000.00::numeric);

-- Removing someone who paid: the payment stays, the debt goes
SELECT tests.eq('Ada M owes the rest before being removed',
  (SELECT contributions_owing FROM member_balances(:'ada_m'::uuid)), 1500.00::numeric);
SELECT tests.eq('removing her is allowed',
  tests.rows(format('DELETE FROM contribution_members WHERE contribution_id = %L AND member_id = %L', :'c', :'ada_m')),
  1::bigint);
SELECT tests.eq('she no longer owes anything', (SELECT contributions_owing FROM member_balances(:'ada_m'::uuid)), 0::numeric);
SELECT tests.eq('her payment is kept', (SELECT count(*) FROM contribution_payments WHERE member_id = :'ada_m'), 1::bigint);
SELECT tests.eq('and still counts as collected',
  (SELECT (x ->> 'collected')::numeric FROM jsonb_array_elements(contribution_progress()) x WHERE x ->> 'name' = 'Burial'),
  500.00::numeric);
SELECT tests.eq('the change is in the history',
  (SELECT count(*) FROM audit_log WHERE table_name = 'contribution_members' AND action = 'delete'), 1::bigint);

-- Viewers and other organizations cannot change it
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('a viewer cannot add people',
  format('INSERT INTO contribution_members (org_id, contribution_id, member_id) VALUES (%L, %L, %L)', :'org2', :'c', :'ada_m'),
  'row-level security');
SELECT tests.eq('a viewer cannot remove people',
  tests.rows(format('DELETE FROM contribution_members WHERE contribution_id = %L', :'c')), 0::bigint);
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('another organization cannot remove people',
  tests.rows(format('DELETE FROM contribution_members WHERE contribution_id = %L', :'c')), 0::bigint);
