-- Choosing who a due applies to.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-09-25';
SELECT tests.as_user(:bola) \gset

SELECT id AS main_branch FROM branches WHERE org_id = :'org2' LIMIT 1 \gset
INSERT INTO branches (org_id, name) VALUES (:'org2', 'Aba Branch') RETURNING id AS aba \gset
INSERT INTO members (org_id, name, joined_on, tags, branch_id) VALUES (:'org2', 'New Nkechi', '2026-01-01', '{new}', :'main_branch') RETURNING id AS nkechi \gset
INSERT INTO members (org_id, name, joined_on, tags, branch_id) VALUES (:'org2', 'Old Obi', '2026-01-01', '{}', :'aba') RETURNING id AS obi \gset

-- Everyone (the default)
INSERT INTO dues (org_id, name, amount, frequency, starts_on) VALUES (:'org2', 'Monthly', 1000, 'monthly', '2026-09-01') RETURNING id AS monthly \gset
SELECT tests.eq('an ordinary due applies to everyone', cardinality(due_member_ids(:'monthly')), 2);

-- By label: a one-off registration fee for members labelled "new"
INSERT INTO dues (org_id, name, amount, frequency, starts_on, audience, audience_labels)
VALUES (:'org2', 'Registration fee', 5000, 'custom', '2026-09-01', 'labels', '{new}') RETURNING id AS reg \gset
SELECT tests.eq('the registration fee applies only to the member labelled new',
  (SELECT array_agg(name) FROM members WHERE id = ANY (due_member_ids(:'reg'))), ARRAY['New Nkechi']);
SELECT tests.eq('Nkechi owes it',
  (SELECT short FROM standing_lines(:'nkechi'::uuid) WHERE ref_id = :'reg'), 5000.00::numeric);
SELECT tests.eq('Obi does not', (SELECT count(*) FROM standing_lines(:'obi'::uuid) WHERE ref_id = :'reg'), 0::bigint);
SELECT tests.eq('the dashboard counts only her', (dashboard_summary() ->> 'owed')::numeric, 1000 + 1000 + 5000.00);

-- Live: giving Obi the label makes him owe; removing Nkechi's label after a part payment keeps her on it
UPDATE members SET tags = '{new}' WHERE id = :'obi';
SELECT tests.eq('labelling Obi "new" adds him', cardinality(due_member_ids(:'reg')), 2);
UPDATE members SET tags = '{}' WHERE id = :'obi';
INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount) VALUES (:'org2', :'reg', :'nkechi', '2026-09-01', 2000);
UPDATE members SET tags = '{}' WHERE id = :'nkechi';
SELECT tests.eq('after a part payment, Nkechi stays on it even without the label',
  (SELECT short FROM standing_lines(:'nkechi'::uuid) WHERE ref_id = :'reg'), 3000.00::numeric);

-- By branch
INSERT INTO dues (org_id, name, amount, frequency, starts_on, audience, audience_branch_ids)
VALUES (:'org2', 'Aba levy', 700, 'custom', '2026-09-01', 'branches', ARRAY[:'aba'::uuid]) RETURNING id AS levy \gset
SELECT tests.eq('a branch due applies only to that branch',
  (SELECT array_agg(name) FROM members WHERE id = ANY (due_member_ids(:'levy'))), ARRAY['Old Obi']);

-- Specific people
INSERT INTO dues (org_id, name, amount, frequency, starts_on, audience)
VALUES (:'org2', 'Exco dues', 300, 'monthly', '2026-09-01', 'people') RETURNING id AS exco \gset
SELECT tests.eq('a due for specific people starts with nobody', cardinality(due_member_ids(:'exco')), 0);
INSERT INTO due_members (org_id, due_id, member_id) VALUES (:'org2', :'exco', :'obi');
SELECT tests.eq('adding Obi makes him owe it',
  (SELECT short FROM standing_lines(:'obi'::uuid) WHERE ref_id = :'exco'), 300.00::numeric);

-- Rules and permissions
SELECT tests.fails('a label due needs at least one label',
  format('INSERT INTO dues (org_id, name, amount, audience) VALUES (%L, ''x'', 10, ''labels'')', :'org2'),
  'dues_audience_labels_present');
SELECT tests.eq('who pays can be changed later',
  tests.rows(format('UPDATE dues SET audience = ''everyone'' WHERE id = %L', :'exco')), 1::bigint);
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('a viewer cannot pick people for a due',
  format('INSERT INTO due_members (org_id, due_id, member_id) VALUES (%L, %L, %L)', :'org2', :'exco', :'nkechi'),
  'row-level security');
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('another organization sees nobody', cardinality(due_member_ids(:'reg')), 0);
