-- Shared starting point for the test files (included with \ir, not run on its own).
--   Ada   admin of Org One
--   Bola  admin of Org Two
--   Vic   viewer in Org Two, still on a temporary password
--   Nia   signed up, no organization yet
\set ada   '''aaaaaaaa-0000-0000-0000-000000000001'''
\set bola  '''bbbbbbbb-0000-0000-0000-000000000002'''
\set vic   '''cccccccc-0000-0000-0000-000000000003'''
\set nia   '''eeeeeeee-0000-0000-0000-000000000005'''

SELECT tests.create_user(:ada, 'ada@test.local'), tests.create_user(:bola, 'bola@test.local'),
       tests.create_user(:vic, 'vic@test.local'), tests.create_user(:nia, 'nia@test.local') \gset

-- Organizations are created the way the app does it: the signed-in user calls setup_organization.
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:ada) \gset
SELECT setup_organization('Org One', 'Ada') AS org1 \gset
SELECT tests.as_user(:bola) \gset
SELECT setup_organization('Org Two', 'Bola') AS org2 \gset
RESET ROLE;

-- Vic is added the way an invite does it (server code with the service role).
INSERT INTO profiles (id, org_id, full_name, must_change_password)
VALUES (:vic, :'org2', 'Vic', true);
INSERT INTO user_roles (user_id, org_id, role) VALUES (:vic, :'org2', 'viewer');

SET LOCAL ROLE authenticated;
