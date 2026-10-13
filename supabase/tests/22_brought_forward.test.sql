-- Debts brought forward from before FinSeka: owed but not money in, paid first, cancellable.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-13';
SELECT tests.as_user(:bola) \gset

INSERT INTO members (org_id, name, joined_on) VALUES (:'org2', 'Titus', '2020-01-01') RETURNING id AS m \gset
INSERT INTO dues (org_id, name, amount, frequency, starts_on)
VALUES (:'org2', 'Monthly dues', 1000, 'monthly', '2026-10-01') RETURNING id AS due \gset

SELECT tests.eq('a new organization is asked for what members owed',
  (SELECT brought_forward_done FROM organizations WHERE id = :'org2'), false);

-- ---------------------------------------------------------------------------
-- Bringing debts forward
-- ---------------------------------------------------------------------------
SELECT tests.eq('ledger before', (SELECT count(*) FROM ledger_entries), 0::bigint);
INSERT INTO brought_forward_debts (org_id, member_id, label, amount, as_of)
VALUES (:'org2', :'m', '  Old dues ', 6000, '2026-09-30') RETURNING id AS d1 \gset
INSERT INTO brought_forward_debts (org_id, member_id, label, amount, note)
VALUES (:'org2', :'m', 'Building levy', 5000, 'From the 2025 book') RETURNING id AS d2 \gset

SELECT tests.eq('labels are tidied', (SELECT label FROM brought_forward_debts WHERE id = :'d1'), 'Old dues');
SELECT tests.eq('what Titus owes: October dues plus both debts',
  (SELECT dues_owing || ' ' || brought_forward || ' ' || total_owing FROM member_balances(:'m'::uuid)),
  '1000.00 11000.00 12000.00');
SELECT tests.eq('the dashboard counts it as owed', (dashboard_summary() ->> 'owed')::numeric, 12000::numeric);
SELECT tests.eq('a debt is not money in: the ledger is untouched', (SELECT count(*) FROM ledger_entries), 0::bigint);
SELECT tests.eq('the member''s lines show each debt',
  (SELECT string_agg(ref_name || ':' || short, ', ' ORDER BY ref_name)
   FROM standing_lines(:'m'::uuid) WHERE kind = 'brought_forward'),
  'Building levy:5000.00, Old dues:6000.00');

SELECT tests.fails('a debt needs a label',
  format('INSERT INTO brought_forward_debts (org_id, member_id, label, amount) VALUES (%L, %L, ''  '', 100)', :'org2', :'m'),
  'brought_forward_debts_label_present');
SELECT tests.fails('and an amount above ₦0',
  format('INSERT INTO brought_forward_debts (org_id, member_id, label, amount) VALUES (%L, %L, ''X'', 0)', :'org2', :'m'),
  'check');
SELECT tests.as_user(:ada) \gset
SELECT tests.fails('another organization''s member cannot be given a debt',
  format('INSERT INTO brought_forward_debts (org_id, member_id, label, amount) VALUES (%L, %L, ''X'', 100)', :'org1', :'m'),
  'Member not found');
SELECT tests.eq('and cannot see these debts', (SELECT count(*) FROM brought_forward_debts), 0::bigint);
SELECT tests.as_user(:vic) \gset
SELECT tests.eq('a viewer sees them', (SELECT count(*) FROM brought_forward_debts), 2::bigint);
SELECT tests.fails('but cannot add one',
  format('INSERT INTO brought_forward_debts (org_id, member_id, label, amount) VALUES (%L, %L, ''X'', 100)', :'org2', :'m'),
  'row-level security');

-- ---------------------------------------------------------------------------
-- Paying
-- ---------------------------------------------------------------------------
SELECT tests.as_user(:bola) \gset
SELECT pay_member_debts(:'m', 7000, '2026-10-13', 'cash') AS paid \gset
SELECT tests.eq('one payment clears the old debts first, then this month''s dues',
  (SELECT string_agg(p ->> 'name' || ':' || (p ->> 'amount'), ', ') FROM jsonb_array_elements(:'paid'::jsonb -> 'parts') p),
  'Old dues:6000.00, Building levy:1000.00');
SELECT tests.eq('what is left', (SELECT brought_forward || ' ' || total_owing FROM member_balances(:'m'::uuid)),
  '4000.00 5000.00');
SELECT tests.eq('the payments are money in, labelled as brought forward',
  (SELECT string_agg(label || '|' || description || '|' || amount, ' / ' ORDER BY amount DESC)
   FROM ledger_entries WHERE source_table = 'brought_forward_payments'),
  'Debt brought forward|Titus paid Old dues (brought forward)|6000.00 / Debt brought forward|Titus paid Building levy (brought forward) — part|1000.00');
SELECT tests.eq('where each debt stands',
  (SELECT string_agg(label || ' ' || paid || '/' || outstanding, ', ' ORDER BY label) FROM brought_forward_status),
  'Building levy 1000.00/4000.00, Old dues 6000.00/0.00');

SELECT tests.fails('a payment cannot be more than is left',
  format('INSERT INTO brought_forward_payments (org_id, debt_id, amount, channel) VALUES (%L, %L, 4001, ''cash'')', :'org2', :'d2'),
  'more than is left');
SELECT tests.fails('a debt cannot be set below what was paid',
  format('UPDATE brought_forward_debts SET amount = 500 WHERE id = %L', :'d2'), 'already been paid');
SELECT tests.eq('but it can be corrected upwards',
  tests.rows(format('UPDATE brought_forward_debts SET amount = 5500 WHERE id = %L', :'d2')), 1::bigint);
UPDATE brought_forward_debts SET amount = 5000 WHERE id = :'d2';

INSERT INTO brought_forward_payments (org_id, debt_id, amount, channel, reference)
VALUES (:'org2', :'d2', 4000, 'bank_transfer', 'GTB 9') RETURNING id AS bp \gset
SELECT tests.eq('paying the rest directly is marked as the balance',
  (SELECT description || '|' || channel FROM ledger_entries WHERE source_id = :'bp'),
  'Titus paid Building levy (brought forward) — balance|bank_transfer');

-- Cancelling a payment reverses it and brings the debt back
SELECT tests.fails('its ledger line cannot be reversed directly',
  format('SELECT reverse_ledger_entry(%L, ''wrong'')',
         (SELECT id FROM ledger_entries WHERE source_id = :'bp')), 'Cancel the payment instead');
SELECT void_payment('brought_forward', :'bp', 'Bank transfer bounced');
SELECT tests.eq('cancelled: the debt is owed again', (SELECT brought_forward FROM member_balances(:'m'::uuid)), 4000::numeric);
SELECT tests.eq('and the ledger line is reversed',
  (SELECT count(*) || ' lines, ' || sum(amount) FROM ledger_entries WHERE source_id = :'bp' OR reverses_id = (SELECT id FROM ledger_entries WHERE source_id = :'bp')),
  '2 lines, 0.00');

-- ---------------------------------------------------------------------------
-- Cancelling a debt entered by mistake
-- ---------------------------------------------------------------------------
SELECT tests.fails('cancelling needs a reason', format('SELECT cancel_brought_forward_debt(%L, '''')', :'d2'), 'Say why');
SELECT cancel_brought_forward_debt(:'d2', 'Was already paid in the old book');
SELECT tests.eq('a cancelled debt is no longer owed', (SELECT brought_forward FROM member_balances(:'m'::uuid)), 0::numeric);
SELECT tests.eq('money paid towards it stays recorded',
  (SELECT count(*) FROM brought_forward_payments WHERE debt_id = :'d2' AND voided_at IS NULL), 1::bigint);
SELECT tests.fails('nothing more can be paid towards it',
  format('INSERT INTO brought_forward_payments (org_id, debt_id, amount, channel) VALUES (%L, %L, 1, ''cash'')', :'org2', :'d2'),
  'was cancelled');
SELECT tests.fails('debts are cancelled, not deleted',
  format('DELETE FROM brought_forward_debts WHERE id = %L', :'d1'), 'permission denied');

SELECT tests.eq('every step is in History',
  (SELECT string_agg(DISTINCT table_name, ',') FROM audit_log
   WHERE table_name IN ('brought_forward_debts', 'brought_forward_payments')),
  'brought_forward_debts,brought_forward_payments');

-- ---------------------------------------------------------------------------
-- Finishing the onboarding step; a plan that has ended
-- ---------------------------------------------------------------------------
SELECT set_brought_forward_done(true);
SELECT tests.eq('the step can be marked done', (SELECT brought_forward_done FROM organizations WHERE id = :'org2'), true);
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('only admins mark it', 'SELECT set_brought_forward_done(false)', 'Only an admin');

RESET ROLE;
UPDATE org_billing SET trial_ends_at = now() - interval '1 day' WHERE org_id = :'org2';
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:bola) \gset
SELECT tests.fails('no debts are added while the plan has ended',
  format('INSERT INTO brought_forward_debts (org_id, member_id, label, amount) VALUES (%L, %L, ''X'', 100)', :'org2', :'m'),
  'plan has ended');
