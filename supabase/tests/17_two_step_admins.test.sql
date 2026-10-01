-- Super admins' powers need a sign-in confirmed with a two-step code (JWT aal = aal2).
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-01';

RESET ROLE;
\set sam '''dddddddd-0000-0000-0000-000000000004'''
SELECT tests.create_user(:sam, 'sam@finseka.test') \gset
INSERT INTO profiles (id, full_name) VALUES (:sam, 'Sam');
INSERT INTO platform_admins (user_id) VALUES (:sam);
SET LOCAL ROLE authenticated;

-- Signed in with a password (or Google) only
SELECT tests.as_user(:sam) \gset
SELECT tests.eq('still listed as a super admin', is_platform_admin_member(), true);
SELECT tests.eq('but without their powers', is_platform_admin(), false);
SELECT tests.eq('the app is told a code is needed',
  (SELECT (x ->> 'is_platform_admin_member') || ' ' || (x ->> 'is_platform_admin') FROM app_context() x), 'true false');
SELECT tests.fails('the console asks for the code', 'SELECT admin_overview()', 'two-step');
SELECT tests.fails('no support session without it',
  format('SELECT start_support_session(%L, ''Helping them out'')', :'org2'), 'two-step');
SELECT tests.fails('no copy for a wipe without it', format('SELECT admin_export_org(%L)', :'org2'), 'two-step');

-- After entering the code
SELECT tests.as_user_2fa(:sam) \gset
SELECT tests.eq('with the code, the powers are back', is_platform_admin(), true);
SELECT start_support_session(:'org2', 'Helping them out', 30) IS NOT NULL AS started \gset
SELECT tests.eq('a support session works', current_org_id(), :'org2'::uuid);

-- The same session read from a sign-in without the code (e.g. a stolen password) does nothing.
SELECT tests.as_user(:sam) \gset
SELECT tests.eq('an open support session does not carry over to a sign-in without the code',
  current_org_id(), NULL::uuid);
SELECT tests.eq('nor admin rights there', is_org_admin(), false);

-- The list shows who has it switched on
SELECT tests.as_user_2fa(:sam) \gset
SELECT tests.eq('not switched on yet', (SELECT two_step FROM admin_list_admins() WHERE is_you), false);
RESET ROLE;
INSERT INTO auth.mfa_factors (user_id, friendly_name, status) VALUES (:sam, 'Phone', 'verified');
SET LOCAL ROLE authenticated;
SELECT tests.eq('switched on once an authenticator is verified',
  (SELECT two_step FROM admin_list_admins() WHERE is_you), true);

-- Ordinary users are unaffected
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('an organization admin still works in their organization', current_org_id(), :'org2'::uuid);
SELECT tests.eq('with admin rights', is_org_admin(), true);
SELECT tests.eq('and is not on the super admin list', is_platform_admin_member(), false);
