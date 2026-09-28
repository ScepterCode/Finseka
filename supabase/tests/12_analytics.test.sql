-- Analytics figures for a date range, with branch and label filters.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-20';
SELECT tests.as_user(:bola) \gset

SELECT id AS main_branch FROM branches WHERE org_id = :'org2' LIMIT 1 \gset
INSERT INTO branches (org_id, name) VALUES (:'org2', 'Aba') RETURNING id AS aba \gset
INSERT INTO members (org_id, name, joined_on, branch_id, tags) VALUES (:'org2', 'Ada', '2026-01-01', :'main_branch', '{youth}') RETURNING id AS ada_m \gset
INSERT INTO members (org_id, name, joined_on, branch_id) VALUES (:'org2', 'Obi', '2026-01-01', :'aba') RETURNING id AS obi \gset
INSERT INTO members (org_id, name, joined_on, branch_id) VALUES (:'org2', 'Chi', '2026-09-15', :'aba') RETURNING id AS chi \gset
INSERT INTO dues (org_id, name, amount, starts_on) VALUES (:'org2', 'Monthly', 1000, '2026-08-01') RETURNING id AS d \gset
-- Aug: Ada paid, Obi paid half. Sep: Ada paid. Oct: nobody yet. Chi joined mid-Sep (owes Sep, Oct).
INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, paid_at, channel)
VALUES (:'org2', :'d', :'ada_m', '2026-08-01', 1000, '2026-08-05', 'cash'),
       (:'org2', :'d', :'obi', '2026-08-01', 500, '2026-08-20', 'pos'),
       (:'org2', :'d', :'ada_m', '2026-09-01', 1000, '2026-09-03', 'cash');
INSERT INTO ledger_entries (org_id, kind, label, amount, channel, entry_date)
VALUES (:'org2', 'expense', 'Chairs', 3000, 'cash', '2026-09-10'), (:'org2', 'expense', 'Hall', 1000, 'bank_transfer', '2026-10-02');

SELECT analytics_summary('2026-08-01', '2026-10-31') AS a \gset
SELECT tests.eq('one row per month', jsonb_array_length(:'a'::jsonb -> 'monthly'), 3);
SELECT tests.eq('money in, August', ((:'a'::jsonb -> 'monthly' -> 0) ->> 'income')::numeric, 1500.00);
SELECT tests.eq('money out, September', ((:'a'::jsonb -> 'monthly' -> 1) ->> 'expense')::numeric, 3000.00);
SELECT tests.eq('August: 2000 due, 1500 collected',
  ((:'a'::jsonb -> 'monthly' -> 0) ->> 'expected')::numeric || '/' || ((:'a'::jsonb -> 'monthly' -> 0) ->> 'collected')::numeric,
  '2000.00/1500.00');
SELECT tests.eq('overall: 8000 due (Aug 2 people, Sep 3, Oct 3), 2500 collected',
  (:'a'::jsonb -> 'collection' ->> 'expected')::numeric || '/' || (:'a'::jsonb -> 'collection' ->> 'collected')::numeric,
  '8000.00/2500.00');
SELECT tests.eq('what is owed, by how late',
  (SELECT string_agg(x ->> 'bucket' || '=' || (x ->> 'amount')::numeric::int, ', ')
   FROM jsonb_array_elements(:'a'::jsonb -> 'aging') x),
  'Not yet late=3000, Up to 1 month late=2000, 1–3 months late=500, Over 3 months late=0');
SELECT tests.eq('total owed matches', (:'a'::jsonb ->> 'owed')::numeric, 5500.00);
SELECT tests.eq('Obi owes most', (:'a'::jsonb -> 'top_owing' -> 0 ->> 'name'), 'Obi');
SELECT tests.eq('spending by category, biggest first', (:'a'::jsonb -> 'spending' -> 0 ->> 'label'), 'Chairs');
SELECT tests.eq('Chi has never paid', (:'a'::jsonb -> 'members' ->> 'never_paid')::int, 1);
SELECT tests.eq('one member joined in the range', (:'a'::jsonb -> 'members' ->> 'joined')::int, 1);

-- Filters narrow the member figures, not the money in and out
SELECT analytics_summary('2026-08-01', '2026-10-31', :'aba') AS b \gset
SELECT tests.eq('Aba branch: Obi owes 2500 and Chi 2000', (:'b'::jsonb ->> 'owed')::numeric, 4500.00);
SELECT tests.eq('money in is still the whole organization', (:'b'::jsonb -> 'totals' ->> 'income')::numeric, 2500.00);
SELECT analytics_summary('2026-08-01', '2026-10-31', NULL, 'youth') AS c \gset
SELECT tests.eq('label "youth": only Ada, who owes October', (:'c'::jsonb ->> 'owed')::numeric, 1000.00);

-- Another organization sees nothing of it
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('Org One sees none of it', (analytics_summary('2026-08-01', '2026-10-31') ->> 'owed')::numeric, 0::numeric);
