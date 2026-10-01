-- System admins: support sessions inside an organization, and wiping an organization out.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-01';

-- Sam works for FinSeka and has no organization of their own.
RESET ROLE;
\set sam '''dddddddd-0000-0000-0000-000000000004'''
SELECT tests.create_user(:sam, 'sam@finseka.test') \gset
INSERT INTO profiles (id, full_name) VALUES (:sam, 'Sam');
INSERT INTO platform_admins (user_id) VALUES (:sam);
SET LOCAL ROLE authenticated;

-- Org Two has some records of every kind.
SELECT tests.as_user(:bola) \gset
INSERT INTO branches (org_id, name) VALUES (:'org2', 'Aba');
INSERT INTO members (org_id, name) VALUES (:'org2', 'Titus') RETURNING id AS m \gset
INSERT INTO dues (org_id, name, amount, frequency, starts_on)
VALUES (:'org2', 'Monthly', 1000, 'monthly', '2026-08-01') RETURNING id AS due \gset
INSERT INTO due_payments (org_id, due_id, member_id, amount, paid_at, method)
VALUES (:'org2', :'due', :'m', 1000, '2026-09-10', 'cash');
INSERT INTO contributions (org_id, name, amount_per_person, mandatory)
VALUES (:'org2', 'Burial', 5000, true) RETURNING id AS c \gset
INSERT INTO contribution_members (org_id, contribution_id, member_id) VALUES (:'org2', :'c', :'m');
INSERT INTO contribution_payments (org_id, contribution_id, member_id, amount, paid_at, method)
VALUES (:'org2', :'c', :'m', 2000, '2026-09-12', 'cash');
INSERT INTO pledge_drives (org_id, name) VALUES (:'org2', 'Roof') RETURNING id AS d \gset
INSERT INTO pledges (org_id, drive_id, pledger_name, amount) VALUES (:'org2', :'d', 'Chief', 9000) RETURNING id AS p \gset
INSERT INTO pledge_payments (org_id, pledge_id, amount, paid_at, channel) VALUES (:'org2', :'p', 3000, '2026-09-20', 'cash');
INSERT INTO ledger_entries (org_id, kind, label, amount) VALUES (:'org2', 'expense', 'Chairs', 4000);

-- ---------------------------------------------------------------------------
-- Only system admins
-- ---------------------------------------------------------------------------
SELECT tests.eq('an organization admin is not a system admin', is_platform_admin(), false);
SELECT tests.fails('an organization admin cannot list organizations', 'SELECT * FROM admin_org_list()', 'system admins');
SELECT tests.fails('an organization admin cannot open another organization',
  format('SELECT start_support_session(%L, ''Just looking'')', :'org1'), 'system admins');
SELECT tests.fails('an organization admin cannot export another organization',
  format('SELECT admin_export_org(%L)', :'org1'), 'system admins');
SELECT tests.fails('app users cannot call the wipe at all',
  format('SELECT wipe_organization(%L, ''Org One'', ''Testing it'', %L)', :'org1', :bola), 'permission denied');
SELECT tests.fails('app users cannot make themselves system admins',
  format('INSERT INTO platform_admins (user_id) VALUES (%L)', :bola), 'permission denied');

SELECT tests.as_user(:sam) \gset
SELECT tests.eq('Sam is a system admin', is_platform_admin(), true);
SELECT tests.eq('the list shows both organizations with counts',
  (SELECT string_agg(name || ':' || members || ':' || team, ' ' ORDER BY name) FROM admin_org_list()),
  'Org One:0:1 Org Two:1:2');
SELECT tests.eq('search finds an organization by its admin''s email',
  (SELECT string_agg(name, ' ') FROM admin_org_list('bola@')), 'Org Two');
SELECT tests.eq('outside a session Sam sees no organization''s records', (SELECT count(*) FROM members), 0::bigint);

-- ---------------------------------------------------------------------------
-- Support session
-- ---------------------------------------------------------------------------
SELECT tests.fails('a reason is required', format('SELECT start_support_session(%L, '''')', :'org2'), 'reason');
SELECT start_support_session(:'org2', 'Bola asked for help with a payment', 30) IS NOT NULL AS started \gset
SELECT tests.eq('in a session Sam works in Org Two', current_org_id(), :'org2'::uuid);
SELECT tests.eq('and acts as its admin', is_org_admin(), true);
SELECT tests.eq('and sees its records', (SELECT count(*) FROM members), 1::bigint);
SELECT tests.eq('app context reports the session',
  (SELECT (app_context() -> 'org' ->> 'name') || ' / ' || (app_context() -> 'support' ->> 'reason')),
  'Org Two / Bola asked for help with a payment');

INSERT INTO members (org_id, name) VALUES (:'org2', 'Added by support');
SELECT tests.eq('changes are labelled as FinSeka support in the history',
  (SELECT actor_label FROM audit_log WHERE table_name = 'members' AND new_row ->> 'name' = 'Added by support'),
  'FinSeka support — Sam');
SELECT tests.eq('the organization''s history shows support opened it, and why',
  (SELECT new_row ->> 'reason' FROM audit_log WHERE org_id = :'org2' AND table_name = 'support_access' AND action = 'start'),
  'Bola asked for help with a payment');
SELECT tests.fails('team changes are refused in a session',
  format('SELECT set_member_role(%L, ''admin'')', :vic), 'support session');
SELECT tests.fails('removing someone is refused in a session',
  format('SELECT remove_team_member(%L)', :vic), 'support session');
SELECT tests.eq('deleting Sam''s own account is blocked in a session',
  account_deletion_blocker(), 'End the support session before deleting your account.');
SELECT tests.fails('Org One stays out of reach', format('INSERT INTO members (org_id, name) VALUES (%L, ''X'')', :'org1'));

SELECT end_support_session();
SELECT tests.eq('after ending, Sam is back outside every organization', current_org_id(), NULL::uuid);
SELECT tests.eq('and sees no records again', (SELECT count(*) FROM members), 0::bigint);

RESET ROLE;
SELECT tests.eq('both appear in Org Two''s history',
  (SELECT string_agg(action, ',' ORDER BY id) FROM audit_log WHERE org_id = :'org2' AND table_name = 'support_access'),
  'start,end');
-- An expired session stops counting.
INSERT INTO support_sessions (admin_id, org_id, reason, started_at, expires_at)
VALUES (:sam, :'org2', 'Old session', now() - interval '2 hours', now() - interval '1 hour');
SET LOCAL ROLE authenticated;
SELECT tests.eq('an expired session gives no access', current_org_id(), NULL::uuid);

-- A system admin removed from platform_admins loses an open session at once.
SELECT start_support_session(:'org1', 'Checking Org One totals', 30) IS NOT NULL AS started \gset
RESET ROLE;
DELETE FROM platform_admins WHERE user_id = :sam;
SET LOCAL ROLE authenticated;
SELECT tests.eq('a removed system admin''s session stops working', current_org_id(), NULL::uuid);
RESET ROLE;
INSERT INTO platform_admins (user_id) VALUES (:sam);
UPDATE support_sessions SET ended_at = now() WHERE admin_id = :sam AND ended_at IS NULL;
SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------------------
-- Wiping out Org Two
-- ---------------------------------------------------------------------------
RESET ROLE;
SELECT tests.fails('a wipe needs a copy downloaded first',
  format('SELECT wipe_organization(%L, ''Org Two'', ''Closing the account'', %L)', :'org2', :sam), 'copy');
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:sam) \gset
SELECT tests.eq('the copy holds every kind of record',
  (SELECT jsonb_array_length(x -> 'members') || ' ' || jsonb_array_length(x -> 'due_payments') || ' ' ||
          jsonb_array_length(x -> 'pledge_payments') || ' ' || jsonb_array_length(x -> 'team') || ' ' ||
          (x -> 'organization' ->> 'name')
   FROM admin_export_org(:'org2') x),
  '2 1 1 2 Org Two');

RESET ROLE;
SELECT tests.fails('the typed name must match',
  format('SELECT wipe_organization(%L, ''Org 2'', ''Closing the account'', %L)', :'org2', :sam), 'does not match');
SELECT tests.fails('a reason is required',
  format('SELECT wipe_organization(%L, ''Org Two'', '''', %L)', :'org2', :sam), 'reason');
SELECT tests.fails('only for system admins, even from server code',
  format('SELECT wipe_organization(%L, ''Org Two'', ''Closing the account'', %L)', :'org2', :bola), 'system admins');

SET LOCAL ROLE service_role;
SELECT wipe_organization(:'org2', '  Org Two ', 'Closing the account at their request', :sam) AS result \gset
RESET ROLE;
SELECT tests.eq('it returns the logins to delete: Bola and Vic',
  (SELECT string_agg(x, ',' ORDER BY x) FROM jsonb_array_elements_text(:'result'::jsonb -> 'user_ids') x),
  :bola || ',' || :vic);
SELECT tests.eq('no row of Org Two is left anywhere',
  (SELECT count(*) FROM organizations WHERE id = :'org2')
  + (SELECT count(*) FROM branches WHERE org_id = :'org2')
  + (SELECT count(*) FROM members WHERE org_id = :'org2')
  + (SELECT count(*) FROM dues WHERE org_id = :'org2')
  + (SELECT count(*) FROM due_rates WHERE org_id = :'org2')
  + (SELECT count(*) FROM due_payments WHERE org_id = :'org2')
  + (SELECT count(*) FROM contributions WHERE org_id = :'org2')
  + (SELECT count(*) FROM contribution_members WHERE org_id = :'org2')
  + (SELECT count(*) FROM contribution_payments WHERE org_id = :'org2')
  + (SELECT count(*) FROM pledge_drives WHERE org_id = :'org2')
  + (SELECT count(*) FROM pledges WHERE org_id = :'org2')
  + (SELECT count(*) FROM pledge_payments WHERE org_id = :'org2')
  + (SELECT count(*) FROM ledger_entries WHERE org_id = :'org2')
  + (SELECT count(*) FROM user_roles WHERE org_id = :'org2')
  + (SELECT count(*) FROM audit_log WHERE org_id = :'org2')
  + (SELECT count(*) FROM profiles WHERE org_id = :'org2'),
  0::bigint);
SELECT tests.eq('Org One is untouched',
  (SELECT count(*) FROM organizations WHERE id = :'org1') + (SELECT count(*) FROM user_roles WHERE org_id = :'org1'),
  2::bigint);
SELECT tests.eq('the wipe is recorded with the name and reason',
  (SELECT org_name || ' — ' || reason FROM platform_audit_log WHERE action = 'wipe'),
  'Org Two — Closing the account at their request');
SELECT tests.eq('nothing is left marked as being wiped', (SELECT count(*) FROM orgs_being_wiped), 0::bigint);

-- Once the logins are deleted (the server does that), the same email can start a new organization.
DELETE FROM auth.users WHERE id = :bola;
SELECT tests.eq('Bola''s login is gone', (SELECT count(*) FROM profiles WHERE id = :bola), 0::bigint);
SELECT tests.create_user(:bola, 'bola@test.local') \gset
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:bola) \gset
SELECT setup_organization('Org Two Again', 'Bola') AS org_again \gset
SELECT tests.eq('the same email can register a new organization',
  (SELECT name FROM organizations WHERE id = :'org_again'), 'Org Two Again');
