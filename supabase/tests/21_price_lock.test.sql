-- Launch price lock: the first payment keeps ₦5,000 a month for 12 months of Pro, even after the
-- launch ends and Pro costs ₦7,000.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-01';

RESET ROLE;
UPDATE org_billing SET trial_ends_at = now() - interval '1 day' WHERE org_id = :'org2';
SET LOCAL ROLE service_role;

-- ---------------------------------------------------------------------------
-- During the launch
-- ---------------------------------------------------------------------------
SELECT tests.eq('a month costs the launch price', pro_quote(:'org2', 1), 5000::numeric);
SELECT tests.eq('a year costs 12 launch months', pro_quote(:'org2', 12), 60000::numeric);
SELECT tests.eq('the standard price is shown beside it',
  (billing_state(:'org2') ->> 'price') || '/' || (billing_state(:'org2') ->> 'standard_price'), '5000/7000');

SELECT tests.eq('a Bachs checkout asks for the quote',
  start_bachs_checkout('ref-year', :'org2', :bola, 'bola@test.local', 12), 60000::numeric);
SELECT tests.eq('and remembers it', (billing_checkout('ref-year') ->> 'amount')::numeric, 60000::numeric);
SELECT tests.fails('paying less than the checkout asked is refused',
  'SELECT record_bachs_payment(''ref-year'', ''chk_a'', 59999, ''NGN'', now(), NULL)', 'does not cover');
SELECT tests.fails('an unknown checkout is refused',
  'SELECT record_bachs_payment(''nobody'', ''chk_b'', 60000, ''NGN'', now(), NULL)', 'Unknown checkout');
SELECT record_bachs_payment('ref-year', 'chk_a', 60000, 'NGN', now(), NULL) AS paid \gset
SELECT tests.eq('the year is paid for',
  (SELECT paid_until FROM org_billing WHERE org_id = :'org2'), (:'paid'::jsonb ->> 'covers_until')::timestamptz);
SELECT tests.eq('the first payment locks ₦5,000 for 12 months from its first month',
  (SELECT locked_price::text || ' ' || (price_locked_until = (:'paid'::jsonb ->> 'covers_from')::timestamptz + interval '12 months')
   FROM org_billing WHERE org_id = :'org2'), '5000 true');

-- Ada's organization (still in its trial) pays for 2 months: its lock starts when the trial ends.
SELECT record_subscription_payment(:'org1', 'manual', 'bank-1', 10000, 'NGN', 2) AS ada_paid \gset
SELECT tests.eq('a trial organization''s lock starts when its paid time starts',
  (SELECT price_locked_until FROM org_billing WHERE org_id = :'org1'),
  (:'ada_paid'::jsonb ->> 'covers_from')::timestamptz + interval '12 months');

-- ---------------------------------------------------------------------------
-- After the launch: Pro costs ₦7,000
-- ---------------------------------------------------------------------------
RESET ROLE;
CREATE OR REPLACE FUNCTION public.pro_monthly_price() RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 7000::numeric $$;
SET LOCAL ROLE service_role;

SELECT tests.eq('Ada''s next 12 months: 10 still locked at ₦5,000, then 2 at ₦7,000',
  pro_quote(:'org1', 12), (10 * 5000 + 2 * 7000)::numeric);
SELECT tests.eq('her next month still shows the locked price', (billing_state(:'org1') ->> 'price')::numeric, 5000::numeric);
SELECT tests.eq('Bola''s lock has run out with his paid year, so he pays ₦7,000',
  pro_quote(:'org2', 1), 7000::numeric);

-- A new organization after the launch pays the standard price and gets no lock.
RESET ROLE;
INSERT INTO organizations (name, created_by) VALUES ('Late Club', :bola) RETURNING id AS late \gset
UPDATE org_billing SET trial_ends_at = now() - interval '1 day' WHERE org_id = :'late';
SET LOCAL ROLE service_role;
SELECT tests.eq('a new organization pays ₦7,000 a month', pro_quote(:'late', 3), 21000::numeric);
SELECT record_subscription_payment(:'late', 'manual', 'bank-late', 7000, 'NGN', 1);
SELECT tests.eq('and its payment locks nothing',
  (SELECT locked_price IS NULL AND price_locked_until IS NULL FROM org_billing WHERE org_id = :'late'), true);

-- ---------------------------------------------------------------------------
-- The app's month picker, and who can use these
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT tests.as_user(:ada) \gset
SELECT tests.eq('the month picker gets 12 prices for the signed-in organization',
  (SELECT jsonb_array_length(my_pro_quotes()) || ' ' || (my_pro_quotes() ->> 11)), '12 64000');
SELECT tests.fails('app users cannot quote other organizations',
  format('SELECT pro_quote(%L, 1)', :'org2'), 'permission denied');
SELECT tests.fails('or start checkouts',
  format('SELECT start_bachs_checkout(''x'', %L, NULL, NULL, 1)', :'org1'), 'permission denied');
SELECT tests.fails('or record payments',
  'SELECT record_bachs_payment(''ref-year'', ''chk_z'', 60000, ''NGN'', now(), NULL)', 'permission denied');
