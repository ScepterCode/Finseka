-- Billing: 30-day trial, Pro payments (online and manual), grace, free plans, and read-only.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-01';

RESET ROLE;
\set sam '''dddddddd-0000-0000-0000-000000000004'''
SELECT tests.create_user(:sam, 'sam@finseka.test') \gset
INSERT INTO profiles (id, full_name) VALUES (:sam, 'Sam');
INSERT INTO platform_admins (user_id) VALUES (:sam);
SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------------------
-- Trial
-- ---------------------------------------------------------------------------
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('a new organization starts a 30-day trial',
  (SELECT (app_context() -> 'billing' ->> 'status')
          || ' ' || ((app_context() -> 'billing' ->> 'trial_ends_at')::timestamptz - now() BETWEEN interval '29 days' AND interval '31 days')),
  'trial true');
SELECT tests.eq('and can record things', tests.rows(format('INSERT INTO members (org_id, name) VALUES (%L, ''Titus'')', :'org2')), 1::bigint);
INSERT INTO pledge_drives (org_id, name) VALUES (:'org2', 'Roof');
SELECT tests.eq('Bola manages the plan', can_manage_billing(), true);
SELECT tests.as_user(:vic) \gset
SELECT tests.eq('a viewer does not', can_manage_billing(), false);

-- ---------------------------------------------------------------------------
-- Trial over, never paid: read-only
-- ---------------------------------------------------------------------------
RESET ROLE;
UPDATE org_billing SET trial_ends_at = now() - interval '1 day' WHERE org_id = :'org2';
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('the plan has ended', app_context() -> 'billing' ->> 'status', 'read_only');
SELECT tests.eq('records can still be seen', (SELECT count(*) FROM members), 1::bigint);
SELECT tests.fails('nothing new can be recorded',
  format('INSERT INTO members (org_id, name) VALUES (%L, ''Uche'')', :'org2'), 'plan has ended');
SELECT tests.fails('nothing can be changed', 'UPDATE members SET name = ''Titus O''', 'plan has ended');
SELECT tests.fails('nothing can be deleted', 'DELETE FROM pledge_drives', 'plan has ended');
SELECT tests.fails('database functions are held back too',
  format('INSERT INTO ledger_entries (org_id, kind, label, amount) VALUES (%L, ''income'', ''Gift'', 100)', :'org2'),
  'plan has ended');
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('another organization is unaffected',
  tests.rows(format('INSERT INTO members (org_id, name) VALUES (%L, ''Kemi'')', :'org1')), 1::bigint);

-- FinSeka support and server code are not held back.
SELECT tests.as_user_2fa(:sam) \gset
SELECT start_support_session(:'org2', 'Fixing a record for them', 30) IS NOT NULL AS started \gset
SELECT tests.eq('support can still fix records',
  tests.rows(format('INSERT INTO members (org_id, name) VALUES (%L, ''Fixed by support'')', :'org2')), 1::bigint);
SELECT end_support_session();
RESET ROLE;
SELECT tests.as_user(NULL) \gset
SELECT tests.eq('server code can still write',
  tests.rows(format('INSERT INTO members (org_id, name) VALUES (%L, ''From the server'')', :'org2')), 1::bigint);

-- ---------------------------------------------------------------------------
-- Paying online
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT tests.fails('an underpayment is refused',
  format('SELECT record_subscription_payment(%L, ''flutterwave'', ''flw-1'', 4000, ''NGN'', 1)', :'org2'), 'does not cover');
SELECT tests.fails('another currency is refused',
  format('SELECT record_subscription_payment(%L, ''flutterwave'', ''flw-1'', 5000, ''USD'', 1)', :'org2'), 'does not cover');
SELECT record_subscription_payment(:'org2', 'flutterwave', 'flw-1', 5000, 'NGN', 1, now(), '{}'::jsonb, NULL, NULL, 'bola@test.local', 'sub-9') AS paid \gset
SELECT tests.eq('a month is paid for, from today',
  (:'paid'::jsonb ->> 'covers_until')::timestamptz - now() BETWEEN interval '28 days' AND interval '31 days', true);
SELECT tests.eq('the same payment is never counted twice',
  record_subscription_payment(:'org2', 'flutterwave', 'flw-1', 5000, 'NGN', 1) ->> 'duplicate', 'true');
SELECT tests.eq('renewals find the organization by the payer''s email', org_for_payer_email(' BOLA@test.local '), :'org2'::uuid);
RESET ROLE;
SELECT tests.eq('only one payment is stored', (SELECT count(*) FROM billing_payments WHERE org_id = :'org2'), 1::bigint);
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('Pro is active again', app_context() -> 'billing' ->> 'status', 'active');
SELECT tests.eq('and recording works again',
  tests.rows(format('INSERT INTO members (org_id, name) VALUES (%L, ''Uche'')', :'org2')), 1::bigint);
SELECT tests.eq('the payment shows in the organization''s billing history',
  (SELECT string_agg(provider || ':' || amount::int, ',') FROM org_billing_payments()), 'flutterwave:5000');
SELECT tests.eq('and in its History',
  (SELECT count(*) FROM audit_log WHERE table_name = 'billing' AND action = 'payment'), 1::bigint);
SELECT tests.eq('auto-renewal is on', (app_context() -> 'billing' ->> 'auto_renew'), 'true');
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('another organization cannot see it', (SELECT count(*) FROM org_billing_payments()), 0::bigint);
SELECT tests.fails('app users cannot record payments themselves',
  format('SELECT record_subscription_payment(%L, ''manual'', ''x'', 5000, ''NGN'', 1)', :'org1'), 'permission denied');

-- Paying during the trial starts after the trial.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT record_subscription_payment(:'org1', 'flutterwave', 'flw-2', 5000, 'NGN', 1) AS early \gset
RESET ROLE;
SELECT tests.eq('a payment during the trial starts when the trial ends',
  (:'early'::jsonb ->> 'covers_from')::timestamptz = (SELECT trial_ends_at FROM org_billing WHERE org_id = :'org1'), true);

-- ---------------------------------------------------------------------------
-- Grace after a missed renewal
-- ---------------------------------------------------------------------------
UPDATE org_billing SET paid_until = now() - interval '1 day' WHERE org_id = :'org2';
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('within 3 days of a missed renewal: grace, still working',
  (SELECT (app_context() -> 'billing' ->> 'status') || ' ' || (app_context() -> 'billing' ->> 'can_write')), 'grace true');
RESET ROLE;
UPDATE org_billing SET paid_until = now() - interval '4 days' WHERE org_id = :'org2';
SET LOCAL ROLE authenticated;
SELECT tests.eq('after 3 days: read-only', app_context() -> 'billing' ->> 'status', 'read_only');

-- ---------------------------------------------------------------------------
-- Super admin tools
-- ---------------------------------------------------------------------------
SELECT tests.fails('organization admins cannot extend their own trial',
  format('SELECT admin_extend_trial(%L, 30, ''Please'')', :'org2'), 'system admins');
SELECT tests.as_user_2fa(:sam) \gset
SELECT admin_extend_trial(:'org2', 14, 'Asked for more time');
SELECT tests.eq('an extended trial lets them work again',
  (SELECT billing_status FROM admin_orgs() WHERE name = 'Org Two'), 'trial');

SELECT admin_record_payment(:'org2', 2, 9000, 'GTB-REF-77', 'Paid by bank transfer (discount)') IS NOT NULL AS manual \gset
SELECT tests.eq('a bank transfer is recorded with any amount',
  (SELECT jsonb_array_length(admin_org_billing(:'org2') -> 'payments')), 2);
SELECT tests.fails('the same reference is not recorded twice',
  format('SELECT admin_record_payment(%L, 1, 5000, ''GTB-REF-77'', '''')', :'org2'), 'already recorded');

RESET ROLE;
UPDATE org_billing SET trial_ends_at = now() - interval '9 days', paid_until = now() - interval '9 days' WHERE org_id = :'org2';
SET LOCAL ROLE authenticated;
SELECT tests.as_user_2fa(:sam) \gset
SELECT admin_set_free_plan(:'org2', true, 'Partner church');
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('a free plan works whatever the dates',
  (SELECT (app_context() -> 'billing' ->> 'status') || ' ' ||
          tests.rows(format('INSERT INTO members (org_id, name) VALUES (%L, ''Free'')', :'org2'))), 'free 1');

SELECT tests.as_user_2fa(:sam) \gset
-- Org One paid during its trial, so it counts as Pro.
SELECT tests.eq('the billing overview counts plans and monthly revenue',
  (SELECT (x ->> 'free') || ' ' || (x ->> 'active') || ' ' || (x ->> 'monthly_revenue') FROM admin_billing_overview() x),
  '1 1 5000');
RESET ROLE;
SELECT tests.eq('every billing action is in the activity log',
  (SELECT string_agg(action, ',' ORDER BY id) FROM platform_audit_log WHERE action IN ('trial_extended', 'payment_recorded', 'free_plan_given')),
  'trial_extended,payment_recorded,free_plan_given');

-- Checkouts
SET LOCAL ROLE service_role;
SELECT create_billing_checkout('finseka-tx-1', :'org1', :ada, 'ada@test.local');
SELECT tests.eq('a checkout is matched back to its organization', org_for_checkout('finseka-tx-1'), :'org1'::uuid);
SELECT mark_auto_renew_cancelled(:'org1');
RESET ROLE;
SELECT tests.eq('cancelling auto-renewal keeps the paid time',
  (SELECT (auto_renew_cancelled_at IS NOT NULL) AND paid_until IS NOT NULL FROM org_billing WHERE org_id = :'org1'), true);
