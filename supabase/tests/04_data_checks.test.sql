-- The database refuses amounts and names that make no sense.
\ir fixtures.sql

SELECT tests.as_user(:bola) \gset

SELECT tests.fails('a ₦0 due is refused',
  format('INSERT INTO dues (org_id, name, amount) VALUES (%L, ''Monthly'', 0)', :'org2'), 'dues_amount_positive');
SELECT tests.fails('a negative late charge is refused',
  format('INSERT INTO dues (org_id, name, amount, penalty_amount) VALUES (%L, ''Monthly'', 1000, -5)', :'org2'),
  'dues_penalty_not_negative');
SELECT tests.fails('a due with a blank name is refused',
  format('INSERT INTO dues (org_id, name, amount) VALUES (%L, ''   '', 1000)', :'org2'), 'dues_name_present');
INSERT INTO dues (org_id, name, amount) VALUES (:'org2', 'Monthly', 1000) RETURNING id AS due \gset
SELECT tests.fails('editing a late charge below zero is refused',
  'UPDATE dues SET penalty_amount = -1', 'dues_penalty_not_negative');

SELECT tests.fails('a compulsory contribution without an amount is refused',
  format('INSERT INTO contributions (org_id, name, amount_per_person, mandatory) VALUES (%L, ''Burial'', 0, true)', :'org2'),
  'contributions_compulsory_has_amount');
SELECT tests.eq('a freewill contribution without an amount is fine',
  tests.rows(format('INSERT INTO contributions (org_id, name, amount_per_person, mandatory) VALUES (%L, ''Projector'', 0, false)', :'org2')),
  1::bigint);
SELECT tests.fails('a negative target is refused',
  'UPDATE contributions SET target_amount = -100', 'contributions_target_not_negative');

SELECT tests.fails('a ₦0 manual ledger entry is refused',
  format('INSERT INTO ledger_entries (org_id, kind, label, amount) VALUES (%L, ''expense'', ''Chairs'', 0)', :'org2'),
  'ledger_entries_amount_sign');
SELECT tests.fails('a negative manual ledger entry is refused',
  format('INSERT INTO ledger_entries (org_id, kind, label, amount) VALUES (%L, ''expense'', ''Chairs'', -50)', :'org2'),
  'ledger_entries_amount_sign');
INSERT INTO ledger_entries (org_id, kind, label, amount) VALUES (:'org2', 'expense', 'Chairs', 500) RETURNING id AS chairs \gset
SELECT reverse_ledger_entry(:'chairs', 'Returned');
SELECT tests.eq('reversal lines are still allowed to be negative',
  (SELECT amount FROM ledger_entries WHERE reverses_id = :'chairs'), -500.00::numeric);

SELECT tests.fails('a member with a blank name is refused',
  format('INSERT INTO members (org_id, name) VALUES (%L, '''')', :'org2'), 'members_name_present');
INSERT INTO members (org_id, name) VALUES (:'org2', 'Chinedu');
SELECT tests.fails('renaming a member to blank is refused',
  format('UPDATE members SET name = '' '' WHERE org_id = %L', :'org2'), 'members_name_present');
SELECT tests.fails('blank organization name is refused',
  'UPDATE organizations SET name = ''''', 'organizations_name_present');
