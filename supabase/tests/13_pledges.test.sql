-- Pledges and gifts: drives, pledges on contributions, redeeming, cancelling, and member details.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-20';
SELECT tests.as_user(:bola) \gset

INSERT INTO members (org_id, name, phone, address, email, gender, date_of_birth, occupation)
VALUES (:'org2', 'Titus', '0803', '12 Aba Road', 'titus@example.com', 'male', '1980-05-01', 'Trader')
RETURNING id AS m \gset

-- Member details
SELECT tests.eq('member details are saved',
  (SELECT email || ' ' || gender || ' ' || date_of_birth || ' ' || occupation FROM members WHERE id = :'m'),
  'titus@example.com male 1980-05-01 Trader');
SELECT tests.fails('a badly formed email is refused',
  format('UPDATE members SET email = ''not-an-email'' WHERE id = %L', :'m'), 'members_email_shape');
SELECT tests.fails('gender is female or male (or left blank)',
  format('UPDATE members SET gender = ''x'' WHERE id = %L', :'m'), 'members_gender_known');
SELECT tests.eq('every detail can be left blank',
  tests.rows(format('INSERT INTO members (org_id, name) VALUES (%L, ''Just a name'')', :'org2')), 1::bigint);

-- A standalone drive, with a member and an outsider pledging
INSERT INTO pledge_drives (org_id, name, target_amount) VALUES (:'org2', 'Church roof', 100000) RETURNING id AS d \gset
INSERT INTO pledges (org_id, drive_id, member_id, pledger_name, amount)
VALUES (:'org2', :'d', :'m', '', 5000) RETURNING id AS p1 \gset
INSERT INTO pledges (org_id, drive_id, pledger_name, pledger_phone, pledger_address, amount, promised_by)
VALUES (:'org2', :'d', 'Chief Okafor', '0809', 'Umuahia', 20000, '2026-12-01') RETURNING id AS p2 \gset
SELECT tests.eq('a member''s pledge takes their name, phone and address',
  (SELECT pledger_name || ' ' || pledger_phone || ' ' || pledger_address FROM pledges WHERE id = :'p1'),
  'Titus 0803 12 Aba Road');
SELECT tests.fails('an outsider needs a name',
  format('INSERT INTO pledges (org_id, drive_id, pledger_name, amount) VALUES (%L, %L, ''  '', 100)', :'org2', :'d'),
  'pledges_name_present');
SELECT tests.fails('a pledge is for a drive or a contribution, not both',
  format('INSERT INTO pledges (org_id, pledger_name, amount) VALUES (%L, ''X'', 100)', :'org2'),
  'pledges_for_one_thing');

-- Pledges are not debts
SELECT tests.eq('a pledge is not owed', (SELECT total_owing FROM member_balances(:'m'::uuid)), 0::numeric);

-- Redeeming
INSERT INTO pledge_payments (org_id, pledge_id, amount, paid_at, channel, reference)
VALUES (:'org2', :'p2', 8000, '2026-10-18', 'bank_transfer', 'GTB 123') RETURNING id AS r1 \gset
SELECT tests.eq('part redemption', (SELECT status || ' ' || redeemed || ' ' || outstanding FROM pledge_status WHERE id = :'p2'),
  'part 8000.00 12000.00');
SELECT tests.eq('it lands in the ledger as money in, with the mode',
  (SELECT label || '|' || description || '|' || amount || '|' || channel || '|' || method || '|' || reference
   FROM ledger_entries WHERE source_table = 'pledge_payments' AND source_id = :'r1'),
  'Pledge|Chief Okafor redeemed a pledge for Church roof — part|8000.00|bank_transfer|transfer|GTB 123');
SELECT tests.fails('cannot redeem more than is left',
  format('INSERT INTO pledge_payments (org_id, pledge_id, amount, channel) VALUES (%L, %L, 12001, ''cash'')', :'org2', :'p2'),
  'more than is left');
INSERT INTO pledge_payments (org_id, pledge_id, amount, paid_at, channel)
VALUES (:'org2', :'p2', 12000, '2026-10-19', 'cash');
SELECT tests.eq('fully redeemed', (SELECT status FROM pledge_status WHERE id = :'p2'), 'redeemed');
SELECT tests.eq('the last one is marked as the balance',
  (SELECT description FROM ledger_entries WHERE source_table = 'pledge_payments' AND amount = 12000),
  'Chief Okafor redeemed a pledge for Church roof — balance');

-- Cancelling a redemption reverses it
SELECT tests.fails('a pledge line cannot be reversed directly',
  format('SELECT reverse_ledger_entry(%L, ''oops'')', (SELECT id FROM ledger_entries WHERE source_id = :'r1')),
  'Cancel the payment instead');
SELECT void_payment('pledge', :'r1', 'Wrong amount');
SELECT tests.eq('after cancelling, the pledge is part-redeemed again',
  (SELECT status || ' ' || outstanding FROM pledge_status WHERE id = :'p2'), 'part 8000.00');
SELECT tests.eq('and the ledger nets to the one good redemption',
  (SELECT sum(amount) FROM ledger_entries WHERE label = 'Pledge'), 12000.00::numeric);
SELECT tests.fails('the amount cannot go below what was redeemed',
  format('UPDATE pledges SET amount = 11000 WHERE id = %L', :'p2'), 'already been redeemed');

-- Cancelling a pledge
SELECT cancel_pledge(:'p1', 'Changed their mind');
SELECT tests.eq('a cancelled pledge', (SELECT status || ' ' || outstanding FROM pledge_status WHERE id = :'p1'), 'cancelled 0.00');
SELECT tests.fails('a cancelled pledge cannot be redeemed',
  format('INSERT INTO pledge_payments (org_id, pledge_id, amount, channel) VALUES (%L, %L, 100, ''cash'')', :'org2', :'p1'),
  'was cancelled');

-- Pledges on a contribution
INSERT INTO contributions (org_id, name, amount_per_person, mandatory) VALUES (:'org2', 'Burial', 0, false) RETURNING id AS c \gset
SELECT tests.fails('a contribution must accept pledges first',
  format('INSERT INTO pledges (org_id, contribution_id, pledger_name, amount) VALUES (%L, %L, ''Ngozi'', 100)', :'org2', :'c'),
  'does not take pledges');
UPDATE contributions SET accepts_pledges = true WHERE id = :'c';
INSERT INTO pledges (org_id, contribution_id, pledger_name, amount) VALUES (:'org2', :'c', 'Ngozi', 3000) RETURNING id AS p3 \gset
SELECT tests.eq('the pledge shows what it is for', (SELECT for_name FROM pledge_status WHERE id = :'p3'), 'Burial');

SELECT tests.fails('a redemption must be more than ₦0',
  format('INSERT INTO pledge_payments (org_id, pledge_id, amount, channel) VALUES (%L, %L, 0, ''cash'')', :'org2', :'p3'),
  'pledge_payments_amount_check');

-- Closed years
SELECT close_financial_year('2025-05-01');
SELECT tests.fails('a redemption cannot be dated in a closed year',
  format('INSERT INTO pledge_payments (org_id, pledge_id, amount, paid_at, channel) VALUES (%L, %L, 100, ''2025-06-01'', ''cash'')', :'org2', :'p3'),
  'closed financial year');

-- Viewers and other organizations
SELECT tests.as_user(:vic) \gset
SELECT tests.eq('a viewer can see pledges', (SELECT count(*) FROM pledge_status), 3::bigint);
SELECT tests.fails('a viewer cannot pledge',
  format('INSERT INTO pledges (org_id, drive_id, pledger_name, amount) VALUES (%L, %L, ''V'', 100)', :'org2', :'d'),
  'row-level security');
SELECT tests.fails('a viewer cannot redeem',
  format('INSERT INTO pledge_payments (org_id, pledge_id, amount, channel) VALUES (%L, %L, 100, ''cash'')', :'org2', :'p3'),
  'row-level security');
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('Org One sees none of Org Two''s pledges', (SELECT count(*) FROM pledge_status), 0::bigint);
SELECT tests.fails('Org One cannot pledge to Org Two''s drive',
  format('INSERT INTO pledges (org_id, drive_id, pledger_name, amount) VALUES (%L, %L, ''A'', 100)', :'org1', :'d'),
  'Pledge drive not found');
SELECT tests.fails('Org One cannot cancel Org Two''s redemptions',
  format('SELECT void_payment(''pledge'', (SELECT %L::uuid), ''nope'')', :'r1'), 'not found');

-- Nobody edits a redemption directly
SELECT tests.as_user(:bola) \gset
SELECT tests.fails('redemptions cannot be edited',
  format('UPDATE pledge_payments SET amount = 1 WHERE id = %L', :'r1'), 'permission denied');
