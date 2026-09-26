-- Periods as dates: labels, join and start dates, amount changes, grace days, opening balance.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-09-25';
SELECT tests.as_user(:bola) \gset

-- Labels and period arithmetic
SELECT tests.eq('monthly label', period_label('monthly', '2026-09-01'), 'Sep 2026');
SELECT tests.eq('yearly label', period_label('yearly', '2026-01-01'), '2026');
SELECT tests.eq('daily label has no leading zero', period_label('daily', '2026-09-05'), '5 Sep 2026');
SELECT tests.eq('weeks start on Monday', period_start_of('weekly', '2026-09-25'), '2026-09-21'::date);
SELECT tests.eq('weekly label is the ISO week', period_label('weekly', '2026-09-21'), 'Week 39, 2026');
SELECT tests.eq('ISO week at the turn of the year', period_label('weekly', period_start_of('weekly', '2027-01-01')), 'Week 53, 2026');
SELECT tests.eq('February ends on the 28th', period_end_of('monthly', '2026-02-01'), '2026-02-28'::date);
SELECT tests.eq('months from Aug to today', (SELECT count(*) FROM due_periods('monthly', '2026-08-15', org_today())), 2::bigint);
SELECT tests.eq('custom dues have one never-ending period',
  (SELECT label || coalesce(period_end::text, ' (open)') FROM due_periods('custom', '2026-01-01', org_today())), 'All time (open)');
RESET ROLE;
SELECT tests.eq('an old weekly label becomes that week''s Monday',
  _period_start_from_label('weekly', 'Week 39, 2026'), '2026-09-21'::date);
SET LOCAL ROLE authenticated;

-- Join dates and start dates
INSERT INTO members (org_id, name, joined_on) VALUES (:'org2', 'Early', '2026-01-10') RETURNING id AS early \gset
INSERT INTO members (org_id, name, joined_on) VALUES (:'org2', 'Newcomer', '2026-09-10') RETURNING id AS newcomer \gset
INSERT INTO dues (org_id, name, amount, frequency, penalty_amount, starts_on)
VALUES (:'org2', 'Monthly', 1000, 'monthly', 200, '2026-07-15') RETURNING id AS due \gset

SELECT tests.eq('a due started mid-July charges July, August and September',
  (SELECT count(*) FROM standing_lines(:'early'::uuid) WHERE kind = 'due'), 3::bigint);
SELECT tests.eq('someone who joined in September owes only September',
  (SELECT string_agg(period_label, ',') FROM standing_lines(:'newcomer'::uuid) WHERE kind = 'due'), 'Sep 2026');
SELECT tests.eq('the current period is September',
  (SELECT period_label FROM standing_lines(:'early'::uuid) WHERE is_current), 'Sep 2026');

-- Payments carry the start of their period, whatever date the app sends
INSERT INTO due_payments (org_id, due_id, member_id, period_start, amount)
VALUES (:'org2', :'due', :'early', '2026-08-17', 1000) RETURNING period_start AS ps, period_label AS pl \gset
SELECT tests.eq('a date inside August is stored as 1 August', :'ps'::date, '2026-08-01'::date);
SELECT tests.eq('and labelled Aug 2026', :'pl'::text, 'Aug 2026');

-- Late charges wait for the grace days
UPDATE dues SET penalty_grace_days = 10 WHERE id = :'due';
SELECT tests.eq('July is 56 days overdue: late charge applies',
  (SELECT penalty FROM standing_lines(:'early'::uuid) WHERE period_label = 'Jul 2026'), 200::numeric);
SELECT tests.eq('August is paid: no late charge',
  (SELECT penalty FROM standing_lines(:'early'::uuid) WHERE period_label = 'Aug 2026'), 0::numeric);
SET LOCAL finseka.today = '2026-08-05';
SELECT tests.eq('5 days after July ends, within 10 grace days: no late charge yet for an unpaid July',
  (SELECT penalty FROM standing_lines(:'early'::uuid) WHERE period_label = 'Jul 2026'), 0::numeric);
SELECT tests.eq('...but July is still owed',
  (SELECT short FROM standing_lines(:'early'::uuid) WHERE period_label = 'Jul 2026'), 1000.00::numeric);
SET LOCAL finseka.today = '2026-09-05';
SELECT tests.eq('Newcomer (joins 10 Sep) is never charged for August',
  (SELECT count(*) FROM standing_lines(:'newcomer'::uuid) WHERE period_label = 'Aug 2026'), 0::bigint);
SET LOCAL finseka.today = '2026-09-25';

-- Changing the amount from a chosen period onward
SELECT tests.fails('the amount cannot be edited directly', 'UPDATE dues SET amount = 1500', 'permission denied');
SELECT tests.fails('rates cannot be written directly',
  format('INSERT INTO due_rates (org_id, due_id, amount, effective_from) VALUES (%L, %L, 1, ''2026-09-01'')', :'org2', :'due'),
  'permission denied');
SELECT change_due_amount(:'due', 1500, '2026-09-10');
SELECT tests.eq('September now costs 1500',
  (SELECT expected FROM standing_lines(:'early'::uuid) WHERE period_label = 'Sep 2026'), 1500.00::numeric);
SELECT tests.eq('August keeps its old price',
  (SELECT expected FROM standing_lines(:'early'::uuid) WHERE period_label = 'Aug 2026'), 1000.00::numeric);
SELECT tests.eq('the due shows today''s amount', (SELECT amount FROM dues WHERE id = :'due'), 1500.00::numeric);
SELECT tests.eq('the dues page lists periods newest first with their amounts',
  (SELECT string_agg(label || '=' || expected::int, ',') FROM due_period_list(:'due')),
  'Sep 2026=1500,Aug 2026=1000,Jul 2026=1000');
SELECT tests.fails('₦0 is refused', format('SELECT change_due_amount(%L, 0, ''2026-09-01'')', :'due'), 'more than');
SELECT tests.as_user(:vic) \gset
SELECT tests.fails('viewers cannot change amounts',
  format('SELECT change_due_amount(%L, 2000, ''2026-09-01'')', :'due'), 'only an admin');

-- Opening balance
SELECT tests.fails('viewers cannot set the opening balance', 'SELECT set_opening_balance(1000, 0)', 'only an admin');
SELECT tests.as_user(:bola) \gset
SELECT tests.fails('negative opening amounts are refused', 'SELECT set_opening_balance(-5, 0)', 'less than');
SELECT set_opening_balance(25000, 180000);
SELECT tests.eq('opening cash and bank are in the ledger',
  (SELECT string_agg(method::text || '=' || amount::int, ',' ORDER BY method) FROM ledger_entries WHERE label = 'Opening balance'),
  'cash=25000,transfer=180000');
SELECT tests.eq('the balance starts from them', (ledger_totals() ->> 'balance')::numeric, 205000.00 + 1000);
SELECT tests.fails('the opening balance can only be set once', 'SELECT set_opening_balance(1, 1)', 'already been set');
SELECT tests.eq('the organization is marked as set up',
  (SELECT opening_balance_set FROM organizations WHERE id = :'org2'), true);
