-- One payment from the member profile, applied to the oldest debts first.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-20';
SELECT tests.as_user(:bola) \gset

INSERT INTO members (org_id, name, joined_on) VALUES (:'org2', 'Titus', '2026-01-01') RETURNING id AS m \gset
INSERT INTO dues (org_id, name, amount, frequency, penalty_amount, penalty_grace_days, starts_on)
VALUES (:'org2', 'Monthly', 1000, 'monthly', 200, 5, '2026-08-01') RETURNING id AS d \gset
INSERT INTO contributions (org_id, name, amount_per_person) VALUES (:'org2', 'Burial', 2000) RETURNING id AS c \gset
INSERT INTO contribution_members (org_id, contribution_id, member_id) VALUES (:'org2', :'c', :'m');
-- Owes: Aug 1000 (+200 late), Sep 1000 (+200 late), Oct 1000, Burial 2000
SELECT tests.eq('owing before', (SELECT total_owing FROM member_balances(:'m'::uuid)), 5400.00::numeric);

SELECT pay_member_debts(:'m', 1500, '2026-10-20', 'pos', 'Ref 12', NULL, 'a0000000-0000-0000-0000-00000000aaaa') AS r \gset
SELECT tests.eq('₦1,500 pays August in full and half of September',
  (SELECT string_agg(period_label || '=' || amount::int, ',' ORDER BY period_start) FROM due_payments WHERE member_id = :'m'),
  'Aug 2026=1000,Sep 2026=500');
SELECT tests.eq('each part keeps the mode and reference',
  (SELECT count(*) FROM due_payments WHERE member_id = :'m' AND channel = 'pos' AND reference = 'Ref 12'), 2::bigint);
SELECT tests.eq('August''s late charge is gone once August is paid; September''s stays',
  (SELECT total_owing FROM member_balances(:'m'::uuid)), 3700.00::numeric);
SELECT tests.eq('the result lists the parts', jsonb_array_length((:'r'::jsonb) -> 'parts'), 2);

-- Saving the same payment again (a retry) records nothing more
SELECT pay_member_debts(:'m', 1500, '2026-10-20', 'pos', 'Ref 12', NULL, 'a0000000-0000-0000-0000-00000000aaaa') AS r2 \gset
SELECT tests.eq('a retry is recognised', ((:'r2'::jsonb) ->> 'already_saved')::boolean, true);
SELECT tests.eq('and adds no payments', (SELECT count(*) FROM due_payments WHERE member_id = :'m'), 2::bigint);

-- Paying the rest reaches the contribution last
SELECT pay_member_debts(:'m', 3500, '2026-10-20', 'cash');
SELECT tests.eq('the rest clears September, October and the burial',
  (SELECT total_owing FROM member_balances(:'m'::uuid)), 0::numeric);
SELECT tests.eq('the burial got the last ₦2,000',
  (SELECT sum(amount) FROM contribution_payments WHERE member_id = :'m'), 2000.00::numeric);

-- Refusals
SELECT tests.fails('more than they owe is refused', format('SELECT pay_member_debts(%L, 10, ''2026-10-20'', ''cash'')', :'m'), 'more than they owe');
SELECT tests.fails('₦0 is refused', format('SELECT pay_member_debts(%L, 0, ''2026-10-20'', ''cash'')', :'m'), 'more than ₦0');
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('a viewer cannot record payments', format('SELECT pay_member_debts(%L, 1, ''2026-10-20'', ''cash'')', :'m'), 'only an admin');
SELECT tests.as_user(:ada) \gset
SELECT tests.fails('another organization cannot either', format('SELECT pay_member_debts(%L, 1, ''2026-10-20'', ''cash'')', :'m'), 'not found');
