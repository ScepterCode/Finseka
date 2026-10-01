-- Admin console: overview, every organization, an organization's details and History,
-- managing super admins, and the activity log.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-01';

RESET ROLE;
\set sam '''dddddddd-0000-0000-0000-000000000004'''
\set tia '''ffffffff-0000-0000-0000-000000000006'''
SELECT tests.create_user(:sam, 'sam@finseka.test'), tests.create_user(:tia, 'tia@finseka.test') \gset
INSERT INTO profiles (id, full_name) VALUES (:sam, 'Sam'), (:tia, 'Tia');
INSERT INTO platform_admins (user_id) VALUES (:sam);
SET LOCAL ROLE authenticated;

SELECT tests.as_user(:bola) \gset
INSERT INTO members (org_id, name) VALUES (:'org2', 'Titus'), (:'org2', 'Uche');
INSERT INTO ledger_entries (org_id, kind, label, amount, entry_date) VALUES (:'org2', 'income', 'Gift', 7000, '2026-09-28');

-- Nobody but super admins
SELECT tests.fails('organization admins get no overview', 'SELECT admin_overview()', 'system admins');
SELECT tests.fails('nor the organization list', 'SELECT * FROM admin_orgs()', 'system admins');
SELECT tests.fails('nor another organization''s History',
  format('SELECT * FROM admin_org_history(%L)', :'org1'), 'system admins');
SELECT tests.fails('nor the list of super admins', 'SELECT * FROM admin_list_admins()', 'system admins');
SELECT tests.fails('nor the activity log', 'SELECT * FROM admin_activity_page()', 'system admins');
SELECT tests.fails('and cannot make anyone a super admin',
  format('SELECT grant_platform_admin(%L, %L)', :bola, :bola), 'permission denied');

SELECT tests.as_user_2fa(:sam) \gset
SELECT tests.eq('overview counts organizations, members and super admins',
  (SELECT (x ->> 'organizations') || ' ' || (x ->> 'members') || ' ' || (x ->> 'super_admins')
   FROM admin_overview() x), '2 2 1');

-- Organizations, page by page
SELECT tests.eq('all organizations with a total',
  (SELECT string_agg(name || ':' || members, ' ' ORDER BY name) || ' of ' || max(total_count) FROM admin_orgs(NULL, 'name')),
  'Org One:0 Org Two:2 of 2');
SELECT tests.eq('one per page, second page',
  (SELECT name || ' of ' || total_count FROM admin_orgs(NULL, 'name', 1, 1)), 'Org Two of 2');
SELECT tests.eq('sorted by members',
  (SELECT name FROM admin_orgs(NULL, 'members', 1, 0)), 'Org Two');
SELECT tests.eq('search by name', (SELECT string_agg(name, ' ') FROM admin_orgs('two')), 'Org Two');

-- One organization
SELECT tests.eq('details show counts and the team with emails and roles',
  (SELECT (x -> 'counts' ->> 'members') || ' ' ||
          (SELECT string_agg((t ->> 'email') || '=' || (t ->> 'role'), ',' ORDER BY t ->> 'email')
           FROM jsonb_array_elements(x -> 'team') t)
   FROM admin_org_detail(:'org2') x),
  '2 bola@test.local=admin,vic@test.local=viewer');
SELECT tests.eq('its History can be read without a support session',
  (SELECT count(*) FROM admin_org_history(:'org2') WHERE table_name = 'members'), 2::bigint);
SELECT tests.eq('names for its History include its members',
  (SELECT count(*) FROM admin_org_names(:'org2') WHERE name IN ('Titus', 'Uche')), 2::bigint);
SELECT tests.eq('reading an organization''s History is recorded',
  (SELECT count(*) FROM admin_activity_page(NULL, 'view_history', :'org2')), 1::bigint);
SELECT * FROM admin_org_history(:'org2', 50, 50);
SELECT tests.eq('later pages are not recorded again',
  (SELECT count(*) FROM admin_activity_page(NULL, 'view_history', :'org2')), 1::bigint);

-- Super admins
RESET ROLE;
SELECT tests.fails('only a super admin can add one, even from server code',
  format('SELECT grant_platform_admin(%L, %L)', :tia, :bola), 'system admins');
SET LOCAL ROLE service_role;
SELECT grant_platform_admin(:tia, :sam);
RESET ROLE;
SELECT tests.fails('nobody is added twice',
  format('SELECT grant_platform_admin(%L, %L)', :tia, :sam), 'already');
SET LOCAL ROLE authenticated;
SELECT tests.eq('both super admins are listed, with who added Tia',
  (SELECT string_agg(email || ':' || coalesce(added_by_email, '-') || ':' || is_you, ' ' ORDER BY added_at, email)
   FROM admin_list_admins()),
  'sam@finseka.test:-:true tia@finseka.test:sam@finseka.test:false');
SELECT tests.fails('nobody can remove themselves', format('SELECT remove_platform_admin(%L)', :sam), 'yourself');

SELECT tests.as_user_2fa(:tia) \gset
SELECT start_support_session(:'org1', 'Helping Org One', 30) IS NOT NULL AS started \gset
SELECT tests.as_user_2fa(:sam) \gset
SELECT remove_platform_admin(:tia);
SELECT tests.eq('a removed super admin is gone from the list',
  (SELECT string_agg(email, ' ') FROM admin_list_admins()), 'sam@finseka.test');
RESET ROLE;
SELECT tests.eq('and their open support session is ended',
  (SELECT count(*) FROM support_sessions WHERE admin_id = :tia AND ended_at IS NULL), 0::bigint);
SET LOCAL ROLE authenticated;

-- The activity log of every super admin, filterable
SELECT tests.eq('every super admin''s actions are in the log',
  (SELECT string_agg(DISTINCT admin_email, ' ') FROM admin_activity_page()), 'sam@finseka.test tia@finseka.test');
SELECT tests.eq('filtered by one super admin',
  (SELECT string_agg(action, ',' ORDER BY id) FROM admin_activity_page(:tia)), 'support_start');
SELECT tests.eq('filtered by action',
  (SELECT string_agg(details ->> 'email', ',' ORDER BY id) FROM admin_activity_page(NULL, 'admin_added')),
  'tia@finseka.test');
SELECT tests.eq('removals are recorded with the email',
  (SELECT details ->> 'email' FROM admin_activity_page(NULL, 'admin_removed')), 'tia@finseka.test');
