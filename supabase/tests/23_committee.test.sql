-- A contribution's committee can be changed after it is created, and can include people who are
-- not members. Only admins change it.
\ir fixtures.sql
SELECT tests.as_user(:bola) \gset

INSERT INTO contributions (org_id, name, amount_per_person, mandatory, committee)
VALUES (:'org2', 'Harvest', 2000, true, ARRAY['Bola']) RETURNING id AS c \gset

SELECT tests.eq('an admin changes the committee, adding someone from outside',
  tests.rows(format('UPDATE contributions SET committee = ARRAY[''Bola'', ''Chief Okafor (guest)''] WHERE id = %L', :'c')),
  1::bigint);
SELECT tests.eq('it is saved', (SELECT array_to_string(committee, ', ') FROM contributions WHERE id = :'c'),
  'Bola, Chief Okafor (guest)');
UPDATE contributions SET closed = true WHERE id = :'c';
SELECT tests.eq('it can still be changed once the contribution is closed',
  tests.rows(format('UPDATE contributions SET committee = ''{}'' WHERE id = %L', :'c')), 1::bigint);
SELECT tests.eq('the change is in History',
  (SELECT count(*) FROM audit_log WHERE table_name = 'contributions' AND action = 'update'
     AND old_row -> 'committee' IS DISTINCT FROM new_row -> 'committee'), 2::bigint);

SELECT tests.as_user(:vic) \gset
SELECT tests.eq('a viewer cannot change it',
  tests.rows(format('UPDATE contributions SET committee = ARRAY[''Vic''] WHERE id = %L', :'c')), 0::bigint);
