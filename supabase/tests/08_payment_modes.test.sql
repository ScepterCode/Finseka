-- Payment modes (cash, bank transfer, POS, ...) and references.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-09-25';
SELECT tests.as_user(:bola) \gset

INSERT INTO members (org_id, name, joined_on) VALUES (:'org2', 'Titus', '2026-01-01') RETURNING id AS m \gset
INSERT INTO dues (org_id, name, amount, starts_on) VALUES (:'org2', 'Monthly', 1000, '2026-09-01') RETURNING id AS d \gset
INSERT INTO contributions (org_id, name, amount_per_person) VALUES (:'org2', 'Burial', 2000) RETURNING id AS c \gset

-- New app: sends the mode
INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, channel, reference)
VALUES (:'org2', :'d', :'m', '2026-09-01', 400, 'pos', '  Moniepoint 4471 ') RETURNING id AS p1 \gset
SELECT tests.eq('POS counts as bank', (SELECT method::text FROM due_payments WHERE id = :'p1'), 'transfer');
SELECT tests.eq('the reference is trimmed', (SELECT reference FROM due_payments WHERE id = :'p1'), 'Moniepoint 4471');
SELECT tests.eq('the ledger line carries mode and reference',
  (SELECT channel::text || ' / ' || reference FROM ledger_entries WHERE source_id = :'p1'), 'pos / Moniepoint 4471');

INSERT INTO contribution_payments (org_id, contribution_id, member_id, amount, channel)
VALUES (:'org2', :'c', :'m', 500, 'cash') RETURNING id AS p2 \gset
SELECT tests.eq('cash stays cash', (SELECT method::text FROM contribution_payments WHERE id = :'p2'), 'cash');
SELECT tests.eq('a blank reference is stored as none', (SELECT reference FROM contribution_payments WHERE id = :'p2'), NULL::text);

-- Old app: sends only cash / transfer
INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, method)
VALUES (:'org2', :'d', :'m', '2026-09-01', 100, 'transfer') RETURNING id AS p3 \gset
SELECT tests.eq('an old-style transfer becomes a bank transfer', (SELECT channel::text FROM due_payments WHERE id = :'p3'), 'bank_transfer');

-- Balances still split into cash and bank correctly
SELECT tests.eq('bank: POS 400 + transfer 100', (ledger_totals() ->> 'bank')::numeric, 500.00);
SELECT tests.eq('cash: 500', (ledger_totals() ->> 'cash')::numeric, 500.00);
SELECT tests.eq('money in by mode',
  (SELECT string_agg(x ->> 'channel' || '=' || (x ->> 'income')::numeric::int, ',' ORDER BY x ->> 'channel')
   FROM jsonb_array_elements(channel_totals()) x),
  'bank_transfer=100,cash=500,pos=400');

-- Reversals keep the mode; posted spending is split by mode
SELECT void_payment('due', :'p1', 'Wrong member');
SELECT tests.eq('the reversal keeps POS and the reference',
  (SELECT channel::text || ' / ' || reference FROM ledger_entries WHERE reverses_id = (SELECT id FROM ledger_entries WHERE source_id = :'p1')),
  'pos / Moniepoint 4471');
INSERT INTO contribution_expenses (org_id, contribution_id, description, amount, channel, reference)
VALUES (:'org2', :'c', 'Canopy', 3000, 'ussd', 'Ref 99'), (:'org2', :'c', 'Food', 2000, 'cash', NULL), (:'org2', :'c', 'Sound', 1000, 'cash', NULL);
SELECT post_contribution_expenses(:'c');
SELECT tests.eq('posted spending: one line per mode',
  (SELECT string_agg(channel::text || '=' || amount::int, ',' ORDER BY channel) FROM ledger_entries WHERE source_table = 'contributions'),
  'cash=3000,ussd=3000');

-- Limits
SELECT tests.fails('a very long reference is refused',
  format('INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, channel, reference) VALUES (%L, %L, %L, ''2026-09-01'', 5, ''cash'', %L)',
         :'org2', :'d', :'m', repeat('x', 101)),
  'reference_length');
SELECT tests.fails('an unknown mode is refused',
  format('INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount, channel) VALUES (%L, %L, %L, ''2026-09-01'', 5, ''bitcoin'')',
         :'org2', :'d', :'m'),
  'invalid input value');
