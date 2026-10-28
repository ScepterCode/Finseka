-- Importing members from a file: all at once, branches matched or created, debts brought forward,
-- and undone while nothing is recorded against them.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-28';
SELECT tests.as_user(:bola) \gset

INSERT INTO branches (org_id, name) VALUES (:'org2', 'Aba');

SELECT import_members('[
  {"name": " Titus Okafor ", "phone": "0803 111 2222", "branch": "aba", "joined_on": "2019-05-01",
   "tags": ["choir", " choir", "executive"], "gender": "Male", "email": "titus@example.com", "owed": 6000},
  {"name": "Ngozi Eze", "branch": "Umuahia  Branch", "owed": 2500.5, "owed_label": "Old levy"},
  {"name": "Chidi"}
]'::jsonb, 'members.xlsx') AS imp \gset

SELECT tests.eq('three members, one new branch, two debts',
  (SELECT (:'imp'::jsonb ->> 'members') || ' ' || (:'imp'::jsonb ->> 'branches') || ' ' ||
          (:'imp'::jsonb ->> 'debts') || ' ' || (:'imp'::jsonb ->> 'owed')), '3 1 2 8500.50');
SELECT tests.eq('names are tidied, an existing branch is matched ignoring case, labels are not repeated',
  (SELECT m.name || '|' || m.phone || '|' || b.name || '|' || m.joined_on || '|' || array_to_string(m.tags, ',') || '|' || m.gender
   FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.name = 'Titus Okafor'),
  'Titus Okafor|0803 111 2222|Aba|2019-05-01|choir,executive|male');
SELECT tests.eq('a new branch is created once',
  (SELECT count(*) FROM branches WHERE org_id = :'org2' AND name = 'Umuahia Branch'), 1::bigint);
SELECT tests.eq('a missing joined date means today',
  (SELECT joined_on FROM members WHERE name = 'Chidi'), '2026-10-28'::date);
SELECT tests.eq('what they owed is brought forward',
  (SELECT string_agg(label || ':' || amount, ', ' ORDER BY amount) FROM brought_forward_debts),
  'Old levy:2500.50, Owed before FinSeka:6000.00');
SELECT tests.eq('and counts in what they owe', (dashboard_summary() ->> 'owed')::numeric, 8500.50::numeric);
SELECT tests.eq('the import is remembered',
  (SELECT file_name || ' ' || member_count FROM member_imports WHERE id = (:'imp'::jsonb ->> 'import_id')::uuid),
  'members.xlsx 3');

-- All or nothing
SELECT tests.fails('a row without a name stops the whole import',
  'SELECT import_members(''[{"name": "Ada"}, {"name": "  "}]''::jsonb)', 'Row 2 has no name');
SELECT tests.fails('a bad email names the row',
  'SELECT import_members(''[{"name": "Ada"}, {"name": "Bad", "email": "nope"}]''::jsonb)', 'Row 2 (Bad)');
SELECT tests.eq('and nothing from it was saved', (SELECT count(*) FROM members WHERE name = 'Ada'), 0::bigint);
SELECT tests.fails('an empty list is refused', 'SELECT import_members(''[]''::jsonb)', 'no members to import');

-- Undo
SELECT import_members('[{"name": "Wrong One"}, {"name": "Wrong Two", "owed": 100}]'::jsonb) AS wrong \gset
SELECT tests.eq('undoing removes exactly that import''s members',
  undo_member_import((:'wrong'::jsonb ->> 'import_id')::uuid), 2);
SELECT tests.eq('the others stay', (SELECT count(*) FROM members WHERE org_id = :'org2'), 3::bigint);
SELECT tests.eq('their debts went with them', (SELECT count(*) FROM brought_forward_debts), 2::bigint);
SELECT tests.fails('an import is undone once',
  format('SELECT undo_member_import(%L)', :'wrong'::jsonb ->> 'import_id'), 'already undone');

INSERT INTO dues (org_id, name, amount, frequency, starts_on)
VALUES (:'org2', 'Monthly', 1000, 'monthly', '2026-10-01') RETURNING id AS due \gset
SELECT pay_member_debts((SELECT id FROM members WHERE name = 'Chidi'), 1000, '2026-10-28', 'cash');
SELECT tests.fails('once payments are recorded, it can no longer be undone',
  format('SELECT undo_member_import(%L)', :'imp'::jsonb ->> 'import_id'), 'can no longer be undone');

-- Who can import
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('a viewer cannot import', 'SELECT import_members(''[{"name": "X"}]''::jsonb)', 'Only an admin');
SELECT tests.eq('but sees the imports', (SELECT count(*) FROM member_imports), 2::bigint);
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('another organization does not', (SELECT count(*) FROM member_imports), 0::bigint);

RESET ROLE;
UPDATE org_billing SET trial_ends_at = now() - interval '1 day' WHERE org_id = :'org2';
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:bola) \gset
SELECT tests.fails('nothing is imported while the plan has ended',
  'SELECT import_members(''[{"name": "Late"}]''::jsonb)', 'plan has ended');
