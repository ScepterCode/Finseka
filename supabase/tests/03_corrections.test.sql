-- Mistakes are corrected by cancelling and reversing, never by editing or deleting.
\ir fixtures.sql

SELECT tests.as_user(:bola) \gset
INSERT INTO members (org_id, name) VALUES (:'org2', 'Bayo') RETURNING id AS m \gset
INSERT INTO dues (org_id, name, amount) VALUES (:'org2', 'Monthly', 1000) RETURNING id AS due \gset
INSERT INTO due_payments (org_id, due_id, member_id, period_label, amount)
VALUES (:'org2', :'due', :'m', 'Sep 2026', 400) RETURNING id AS pay \gset
INSERT INTO ledger_entries (org_id, kind, label, amount) VALUES (:'org2', 'expense', 'Chairs', 1500)
RETURNING id AS chairs \gset

-- Direct edits are refused
SELECT tests.fails('payments cannot be edited', 'UPDATE due_payments SET amount = 1', 'permission denied');
SELECT tests.fails('ledger lines cannot be deleted', 'DELETE FROM ledger_entries', 'permission denied');
SELECT tests.fails('members cannot be deleted', 'DELETE FROM members', 'permission denied');
SELECT tests.fails('a due''s amount cannot be edited', 'UPDATE dues SET amount = 1', 'permission denied');
SELECT tests.eq('member details can be edited',
  tests.rows('UPDATE members SET name = ''Bayo Ade'', phone = ''0803'''), 1::bigint);
SELECT tests.eq('due name and late charge can be edited',
  tests.rows('UPDATE dues SET name = ''Monthly dues'', penalty_amount = 300'), 1::bigint);

-- Cancelling a payment
SELECT tests.fails('a reason is required', format('SELECT void_payment(''due'', %L, ''x'')', :'pay'), 'say why');
SELECT void_payment('due', :'pay', 'Recorded for the wrong member');
SELECT tests.eq('the payment is kept, marked cancelled',
  (SELECT void_reason FROM due_payments WHERE id = :'pay'), 'Recorded for the wrong member');
SELECT tests.eq('its ledger line is marked reversed',
  (SELECT reversed_at IS NOT NULL FROM ledger_entries WHERE source_id = :'pay'), true);
SELECT tests.eq('a reversing line of -400 is added',
  (SELECT amount FROM ledger_entries WHERE reverses_id = (SELECT id FROM ledger_entries WHERE source_id = :'pay')),
  -400.00::numeric);
SELECT tests.eq('money in is back to 0', (ledger_totals() ->> 'income')::numeric, 0::numeric);
SELECT tests.fails('a payment cannot be cancelled twice',
  format('SELECT void_payment(''due'', %L, ''again'')', :'pay'), 'already been cancelled');

-- The next payment ignores the cancelled one
INSERT INTO due_payments (org_id, due_id, member_id, period_label, amount)
VALUES (:'org2', :'due', :'m', 'Sep 2026', 1000);
SELECT tests.eq('a full payment after a cancel is not called "balance paid"',
  (SELECT description FROM ledger_entries WHERE source_table = 'due_payments' AND amount = 1000),
  'Bayo Ade paid Monthly dues (Sep 2026)');

-- Reversing ledger lines
SELECT reverse_ledger_entry(:'chairs', 'Chairs were returned');
SELECT tests.eq('money out is back to 0', (ledger_totals() ->> 'expense')::numeric, 0::numeric);
SELECT tests.fails('a reversal cannot be reversed',
  format('SELECT reverse_ledger_entry((SELECT id FROM ledger_entries WHERE reverses_id = %L), ''undo'')', :'chairs'),
  'itself a reversal');
SELECT tests.fails('a line cannot be reversed twice',
  format('SELECT reverse_ledger_entry(%L, ''twice'')', :'chairs'), 'already been reversed');
SELECT tests.fails('a payment''s ledger line must be cancelled via the payment',
  'SELECT reverse_ledger_entry((SELECT id FROM ledger_entries WHERE source_table = ''due_payments'' AND reversed_at IS NULL LIMIT 1), ''should be refused'')',
  'cancel the payment instead');

-- Who may correct
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('a viewer cannot cancel payments',
  format('SELECT void_payment(''due'', (SELECT id FROM due_payments WHERE voided_at IS NULL LIMIT 1), ''viewer tries'')'),
  'only an admin');
SELECT tests.as_user(:ada) \gset
SELECT tests.fails('another organization''s admin cannot cancel them',
  format('SELECT void_payment(''due'', %L, ''other org tries'')', :'pay'), 'not found');

-- Event spending is locked once posted
SELECT tests.as_user(:bola) \gset
INSERT INTO contributions (org_id, name, amount_per_person) VALUES (:'org2', 'Burial', 2000) RETURNING id AS c \gset
INSERT INTO contribution_expenses (org_id, contribution_id, description, amount, method)
VALUES (:'org2', :'c', 'Canopy', 20000, 'cash'), (:'org2', :'c', 'Sound', 15000, 'transfer');
SELECT post_contribution_expenses(:'c');
SELECT tests.eq('spending is posted as one line per payment method',
  (SELECT count(*) FROM ledger_entries WHERE source_table = 'contributions'), 2::bigint);
SELECT tests.fails('spending cannot be posted twice',
  format('SELECT post_contribution_expenses(%L)', :'c'), 'already been posted');
SELECT tests.fails('spending cannot be added after posting',
  format('INSERT INTO contribution_expenses (org_id, contribution_id, description, amount) VALUES (%L, %L, ''Late'', 5)', :'org2', :'c'),
  'row-level security');

-- History records it all
SELECT tests.eq('the cancellation is in the history',
  (SELECT count(*) FROM audit_log WHERE table_name = 'due_payments' AND action = 'update'
     AND new_row ->> 'void_reason' = 'Recorded for the wrong member'), 1::bigint);
