-- Financial years: the year-end statement, closing a year, and the lock on its dates.
\ir fixtures.sql
SET LOCAL finseka.today = '2027-02-10';
SELECT tests.as_user(:bola) \gset

INSERT INTO members (org_id, name, joined_on) VALUES (:'org2', 'Titus', '2026-01-01') RETURNING id AS m \gset
INSERT INTO dues (org_id, name, amount, starts_on, frequency) VALUES (:'org2', 'Levy', 1000, '2026-06-01', 'custom') RETURNING id AS d \gset
INSERT INTO ledger_entries (org_id, kind, label, amount, channel, entry_date)
VALUES (:'org2', 'income', 'Donation', 5000, 'cash', '2025-12-20'),          -- before FY 2026
       (:'org2', 'income', 'Donation', 20000, 'bank_transfer', '2026-03-01'),
       (:'org2', 'expense', 'Chairs', 8000, 'cash', '2026-07-01'),
       (:'org2', 'income', 'Donation', 1000, 'cash', '2027-01-05');          -- in FY 2027
INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, paid_at, channel)
VALUES (:'org2', :'d', :'m', '2026-06-01', 400, '2026-06-15', 'cash') RETURNING id AS pay \gset

-- Default: January to December
SELECT tests.eq('the default year is the calendar year',
  (SELECT label || ' ' || starts_on || '..' || ends_on FROM financial_year_of('2026-08-01')), 'FY 2026 2026-01-01..2026-12-31');
SELECT financial_year_summary('2026-05-01') AS s \gset
SELECT tests.eq('opening money is what was there before the year', (:'s'::jsonb ->> 'opening_cash')::numeric, 5000.00);
SELECT tests.eq('income during the year', (:'s'::jsonb ->> 'income')::numeric, 20400.00);
SELECT tests.eq('spending during the year', (:'s'::jsonb ->> 'expense')::numeric, 8000.00);
SELECT tests.eq('closing cash = 5000 + 400 - 8000', (:'s'::jsonb ->> 'closing_cash')::numeric, -2600.00);
SELECT tests.eq('closing bank', (:'s'::jsonb ->> 'closing_bank')::numeric, 20000.00);

-- Closing
SELECT tests.fails('the current year cannot be closed yet', 'SELECT close_financial_year(''2027-01-15'')', 'has not ended');
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('a viewer cannot close a year', 'SELECT close_financial_year(''2026-05-01'')', 'only an admin');
SELECT tests.as_user(:bola) \gset
SELECT close_financial_year('2026-05-01', 'Approved at AGM');
SELECT tests.eq('the closed year keeps its figures', ((financial_year_summary('2026-05-01')) ->> 'closed')::boolean, true);
SELECT tests.fails('a year cannot be closed twice', 'SELECT close_financial_year(''2026-05-01'')', 'already closed');

-- The lock
SELECT tests.fails('no new ledger entry dated in the closed year',
  format('INSERT INTO ledger_entries (org_id, kind, label, amount, channel, entry_date) VALUES (%L, ''expense'', ''Late bill'', 100, ''cash'', ''2026-11-30'')', :'org2'),
  'closed financial year');
SELECT tests.fails('no new payment dated in the closed year',
  format('INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, paid_at) VALUES (%L, %L, %L, ''2026-06-01'', 100, ''2026-12-01'')', :'org2', :'d', :'m'),
  'closed financial year');
SELECT tests.eq('entries dated in the new year are fine',
  tests.rows(format('INSERT INTO ledger_entries (org_id, kind, label, amount, channel, entry_date) VALUES (%L, ''expense'', ''Hall'', 100, ''cash'', ''2027-02-01'')', :'org2')),
  1::bigint);
SELECT void_payment('due', :'pay', 'Found out it was a mistake');
SELECT tests.eq('a payment from the closed year can still be cancelled; the reversal is dated today',
  (SELECT entry_date FROM ledger_entries WHERE reverses_id = (SELECT id FROM ledger_entries WHERE source_id = :'pay')), '2027-02-10'::date);
SELECT tests.eq('and the closed year''s saved figures do not change',
  ((financial_year_summary('2026-05-01')) ->> 'income')::numeric, 20400.00);

-- Start month
SELECT tests.fails('the start month cannot change after a year is closed',
  'UPDATE organizations SET fiscal_year_start_month = 4', 'cannot change');
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('Org One can set an April start', tests.rows('UPDATE organizations SET fiscal_year_start_month = 4'), 1::bigint);
SELECT tests.eq('April years are labelled across two years',
  (SELECT label || ' ' || starts_on FROM financial_year_of('2027-02-10')), 'FY 2026/27 2026-04-01');
SELECT tests.eq('Org One sees none of Org Two''s closed years', (SELECT count(*) FROM fiscal_years), 0::bigint);
