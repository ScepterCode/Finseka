-- Part payments, the ledger mirror, and the totals every page shows.
\ir fixtures.sql

SELECT tests.as_user(:bola) \gset
INSERT INTO members (org_id, name) VALUES (:'org2', 'Ada M') RETURNING id AS m_ada \gset
INSERT INTO members (org_id, name) VALUES (:'org2', 'Bayo') RETURNING id AS m_bayo \gset
INSERT INTO members (org_id, name) VALUES (:'org2', 'Chidi') RETURNING id AS m_chidi \gset
INSERT INTO members (org_id, name, active) VALUES (:'org2', 'Dayo', false) RETURNING id AS m_dayo \gset

-- A monthly due of 1000 with a 200 late charge. Its start date is pinned so the test
-- does not depend on today's date.
RESET ROLE;
INSERT INTO dues (org_id, name, amount, frequency, penalty_amount, created_at)
VALUES (:'org2', 'Monthly', 1000, 'monthly', 200, '2026-08-01') RETURNING id AS due \gset
SET LOCAL ROLE authenticated;
\set P '''{"monthly":[{"label":"Sep 2026","ends_on":"2026-09-30"},{"label":"Aug 2026","ends_on":"2026-08-31"},{"label":"Jul 2026","ends_on":"2026-07-31"}]}'''

-- Instalments
INSERT INTO due_payments (org_id, due_id, member_id, period_label, amount, method)
VALUES (:'org2', :'due', :'m_ada', 'Sep 2026', 600, 'cash'),
       (:'org2', :'due', :'m_ada', 'Aug 2026', 1000, 'cash'),
       (:'org2', :'due', :'m_bayo', 'Aug 2026', 1000, 'cash'),
       (:'org2', :'due', :'m_bayo', 'Sep 2026', 400, 'cash');
INSERT INTO due_payments (org_id, due_id, member_id, period_label, amount, method)
VALUES (:'org2', :'due', :'m_ada', 'Sep 2026', 400, 'transfer');
SELECT tests.eq('a second instalment is accepted',
  (SELECT count(*) FROM due_payments WHERE member_id = :'m_ada' AND period_label = 'Sep 2026'), 2::bigint);
SELECT tests.eq('first instalment is labelled part payment',
  (SELECT description FROM ledger_entries WHERE member_id = :'m_ada' AND amount = 600),
  'Ada M paid Monthly (Sep 2026) — part payment');
SELECT tests.eq('completing instalment is labelled balance paid',
  (SELECT description FROM ledger_entries WHERE member_id = :'m_ada' AND amount = 400),
  'Ada M paid Monthly (Sep 2026) — balance paid');
SELECT tests.eq('payment method is carried to the ledger',
  (SELECT method::text FROM ledger_entries WHERE member_id = :'m_ada' AND amount = 400), 'transfer');

-- Saving the same form twice records one payment
INSERT INTO due_payments (org_id, due_id, member_id, period_label, amount, client_ref)
VALUES (:'org2', :'due', :'m_chidi', 'Sep 2026', 100, 'a0000000-0000-0000-0000-000000000001');
INSERT INTO due_payments (org_id, due_id, member_id, period_label, amount, client_ref)
VALUES (:'org2', :'due', :'m_chidi', 'Sep 2026', 100, 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT (client_ref) DO NOTHING;
SELECT tests.eq('a retried save is ignored',
  (SELECT count(*) FROM due_payments WHERE member_id = :'m_chidi'), 1::bigint);
-- (remove it again so the totals below match the worked example)
RESET ROLE;
DELETE FROM due_payments WHERE member_id = :'m_chidi';
SET LOCAL ROLE authenticated;

SELECT tests.fails('a zero payment is refused',
  format('INSERT INTO due_payments (org_id, due_id, member_id, period_label, amount) VALUES (%L, %L, %L, ''Sep 2026'', 0)',
         :'org2', :'due', :'m_chidi'), 'amount_positive');

-- Contributions: compulsory Burial 2000 (Ada M, Bayo picked), freewill Projector 3000 (Chidi picked)
INSERT INTO contributions (org_id, name, amount_per_person, mandatory)
VALUES (:'org2', 'Burial', 2000, true) RETURNING id AS burial \gset
INSERT INTO contributions (org_id, name, amount_per_person, mandatory)
VALUES (:'org2', 'Projector', 3000, false) RETURNING id AS projector \gset
INSERT INTO contribution_members (org_id, contribution_id, member_id)
VALUES (:'org2', :'burial', :'m_ada'), (:'org2', :'burial', :'m_bayo'), (:'org2', :'projector', :'m_chidi');
INSERT INTO contribution_payments (org_id, contribution_id, member_id, amount, method)
VALUES (:'org2', :'burial', :'m_ada', 2000, 'transfer'), (:'org2', :'burial', :'m_bayo', 500, 'cash');

-- More than 1,000 ledger rows, and a spend
INSERT INTO ledger_entries (org_id, kind, label, amount, method)
SELECT :'org2', 'income', 'Donation', 1, 'cash' FROM generate_series(1, 1200);
INSERT INTO ledger_entries (org_id, kind, label, amount, method)
VALUES (:'org2', 'expense', 'Chairs', 1500, 'cash');

-- Worked example:
--   Sep (current): Ada M paid 1000, Bayo 400 (short 600), Chidi 0 (short 1000)
--   Aug (past):    Ada M and Bayo paid; Chidi short 1000 + 200 late charge
--   Jul: before the due existed, not counted. Dayo is inactive. The freewill Projector is never owed.
--   Burial: Bayo short 1500.
SELECT tests.eq('Bayo owes 2100',
  (SELECT total_owing FROM member_balances(:P) WHERE name = 'Bayo'), 2100.00::numeric);
SELECT tests.eq('Chidi owes 2200 including the late charge',
  (SELECT total_owing FROM member_balances(:P) WHERE name = 'Chidi'), 2200.00::numeric);
SELECT tests.eq('Ada M owes nothing',
  (SELECT total_owing FROM member_balances(:P) WHERE name = 'Ada M'), 0.00::numeric);
SELECT tests.eq('inactive members are left out of the totals',
  (SELECT count(*) FROM member_balances(:P) WHERE name = 'Dayo'), 0::bigint);
SELECT tests.eq('an inactive member''s own profile still shows what they owe',
  (SELECT total_owing FROM member_balances(:P, :'m_dayo')), 2200.00::numeric);

SELECT tests.eq('dashboard: total owed', (dashboard_summary(:P) ->> 'owed')::numeric, 4300.00);
SELECT tests.eq('dashboard: paid this period', (dashboard_summary(:P) ->> 'dues_paid')::int, 1);
SELECT tests.eq('dashboard: not paid this period', (dashboard_summary(:P) ->> 'dues_unpaid')::int, 2);
SELECT tests.eq('money in, across 1,200+ rows', (ledger_totals() ->> 'income')::numeric, 7100.00);
SELECT tests.eq('cash in hand', (ledger_totals() ->> 'cash')::numeric, 3200.00);
SELECT tests.eq('in the bank', (ledger_totals() ->> 'bank')::numeric, 2400.00);
SELECT tests.eq('report lists the two people owing',
  jsonb_array_length(report_summary('2020-01-01', '2100-01-01', :P) -> 'defaulters'), 2);
SELECT tests.eq('burial progress: 1 of 2 paid in full',
  (SELECT (c ->> 'paid_people')::int FROM jsonb_array_elements(contribution_progress()) c WHERE c ->> 'name' = 'Burial'), 1);

-- The other organization sees none of it
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('Org One sees none of Org Two''s money', (ledger_totals() ->> 'income')::numeric, 0::numeric);
SELECT tests.eq('Org One owes nothing', (dashboard_summary(:P) ->> 'owed')::numeric, 0::numeric);
