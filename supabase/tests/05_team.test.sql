-- Removing people, changing roles, the last-admin rule, and invites.
\ir fixtures.sql

-- Removing someone keeps their login but takes them out of the organization
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('a viewer cannot remove people',
  format('SELECT remove_team_member(%L)', :bola), 'only an admin');
SELECT tests.as_user(:bola) \gset
SELECT tests.fails('an admin cannot remove themselves',
  format('SELECT remove_team_member(%L)', :bola), 'cannot remove yourself');
SELECT tests.fails('an admin cannot remove someone from another organization',
  format('SELECT remove_team_member(%L)', :ada), 'not in your organization');
SELECT remove_team_member(:vic);
RESET ROLE;
SELECT tests.eq('Vic''s login still exists', (SELECT count(*) FROM auth.users WHERE id = :vic), 1::bigint);
SELECT tests.eq('Vic no longer belongs to Org Two', (SELECT org_id FROM profiles WHERE id = :vic), NULL::uuid);
SELECT tests.eq('Vic''s role is gone', (SELECT count(*) FROM user_roles WHERE user_id = :vic), 0::bigint);
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:vic) \gset
SELECT tests.eq('Vic can no longer see Org Two''s history', (SELECT count(*) FROM audit_log), 0::bigint);

-- Invites (server only)
SELECT tests.fails('the app cannot call the invite helper directly',
  format('SELECT attach_member(%L, %L, ''admin'', ''Vic'', false)', :vic, :'org1'), 'permission denied');
SELECT tests.fails('the app cannot look up users by email',
  'SELECT user_id_for_email(''vic@test.local'')', 'permission denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT tests.eq('the server can find a login by email',
  user_id_for_email(' VIC@test.local '), :vic::uuid);
SELECT attach_member(:vic, :'org2', 'viewer', 'Vic', false);
SELECT tests.fails('inviting someone already on the team is refused',
  format('SELECT attach_member(%L, %L, ''viewer'', ''Vic'', false)', :vic, :'org2'), 'already on your team');
SELECT tests.fails('inviting someone from another organization is refused',
  format('SELECT attach_member(%L, %L, ''viewer'', ''Ada'', false)', :ada, :'org2'), 'another organization');
RESET ROLE;
SELECT tests.eq('an existing login without an organization is attached',
  (SELECT org_id FROM profiles WHERE id = :vic), :'org2'::uuid);
SELECT tests.eq('Vic kept her own password (no forced change)',
  (SELECT must_change_password FROM profiles WHERE id = :vic), false);
SET LOCAL ROLE authenticated;

-- Roles and the last admin
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('Bola may not delete her account while she is the only admin',
  account_deletion_blocker() IS NOT NULL, true);
SELECT tests.fails('the only admin cannot demote herself',
  format('SELECT set_member_role(%L, ''viewer'')', :bola), 'at least one admin');
SELECT set_member_role(:vic, 'admin');
SELECT tests.as_user(:vic) \gset
SELECT tests.eq('Vic is now an admin', is_org_admin(), true);
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('with a second admin, Bola may delete her account', account_deletion_blocker(), NULL::text);
SELECT set_member_role(:bola, 'viewer');
SELECT tests.eq('Bola could step down once Vic was an admin', is_org_admin(), false);
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('alone in her organization, Ada may delete her account', account_deletion_blocker(), NULL::text);
SELECT tests.fails('an admin cannot change roles in another organization',
  format('SELECT set_member_role(%L, ''viewer'')', :vic), 'not in your organization');
