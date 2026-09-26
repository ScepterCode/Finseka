-- Organizations are sealed off from each other, roles cannot be self-granted,
-- and signed-out visitors can reach nothing.
\ir fixtures.sql

SELECT tests.as_user(:bola) \gset
INSERT INTO members (org_id, name) VALUES (:'org2', 'Chinedu');
INSERT INTO ledger_entries (org_id, kind, label, amount) VALUES (:'org2', 'income', 'Donation', 5000);

-- Admin rights belong to one organization
SELECT tests.eq('Bola is admin of Org Two', is_org_admin(), true);
SELECT tests.as_user(:vic) \gset
SELECT tests.eq('Vic (viewer) is not an admin', is_org_admin(), false);
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('Ada is admin of Org One', is_org_admin(), true);

-- Moving into another organization
SELECT tests.fails('Ada cannot move her profile into Org Two',
  format('UPDATE profiles SET org_id = %L WHERE id = auth.uid()', :'org2'), 'permission denied');
SELECT tests.as_user(:nia) \gset
SELECT tests.fails('Nia cannot create a profile pointing at Org Two',
  format('INSERT INTO profiles (id, org_id) VALUES (auth.uid(), %L)', :'org2'), 'permission denied');

-- Own name only
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('Ada can rename herself',
  tests.rows('UPDATE profiles SET full_name = ''Ada O.'' WHERE id = auth.uid()'), 1::bigint);
SELECT tests.eq('Ada cannot rename Bola',
  tests.rows(format('UPDATE profiles SET full_name = ''x'' WHERE id = %L', :bola)), 0::bigint);

-- Other organizations' data is invisible
SELECT tests.eq('Ada sees no Org Two members', (SELECT count(*) FROM members), 0::bigint);
SELECT tests.eq('Ada sees no Org Two ledger', (SELECT count(*) FROM ledger_entries), 0::bigint);
SELECT tests.eq('Ada sees no Org Two history',
  (SELECT count(*) FROM audit_log WHERE org_id = :'org2'), 0::bigint);

-- Roles
SELECT tests.fails('Ada cannot grant roles',
  format('INSERT INTO user_roles (user_id, org_id, role) VALUES (%L, %L, ''admin'')', :vic, :'org1'),
  'permission denied');
SELECT tests.as_user(:bola) \gset
SELECT tests.fails('Bola cannot promote Vic directly',
  'UPDATE user_roles SET role = ''admin''', 'permission denied');

-- Forced password change cannot be skipped
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('Vic cannot clear her own password-change flag',
  'UPDATE profiles SET must_change_password = false WHERE id = auth.uid()', 'permission denied');

-- Organization settings: name and logo only
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('Bola can rename Org Two',
  tests.rows('UPDATE organizations SET name = ''Org Two Union'''), 1::bigint);
SELECT tests.fails('Bola cannot set the opening-balance flag directly',
  'UPDATE organizations SET opening_balance_set = true', 'permission denied');

-- History is readable by the team, writable by nobody
SELECT tests.as_user(:vic) \gset
SELECT tests.eq('Vic can read Org Two history', (SELECT count(*) > 0 FROM audit_log), true);
SELECT tests.fails('Vic cannot write history',
  format('INSERT INTO audit_log (org_id, table_name, action) VALUES (%L, ''x'', ''insert'')', :'org2'),
  'permission denied');

-- Signed-out visitors
SET LOCAL ROLE anon;
SELECT tests.as_user(NULL) \gset
SELECT tests.fails('Signed out: cannot read members', 'SELECT * FROM members', 'permission denied');
SELECT tests.fails('Signed out: cannot read the ledger', 'SELECT * FROM ledger_entries', 'permission denied');
SELECT tests.fails('Signed out: cannot call the dashboard', 'SELECT dashboard_summary(''{}'')', 'permission denied');
SELECT tests.fails('Signed out: cannot set up an organization',
  'SELECT setup_organization(''x'', ''y'')', 'permission denied');
