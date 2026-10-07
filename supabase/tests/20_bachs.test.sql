-- Paying through Bachs: several months at once, matched to the organization by its checkout reference.
\ir fixtures.sql
SET LOCAL finseka.today = '2026-10-01';

RESET ROLE;
UPDATE org_billing SET trial_ends_at = now() - interval '1 day' WHERE org_id = :'org2';
SET LOCAL ROLE service_role;

SELECT create_bachs_checkout('finseka-ref-5', :'org2', :bola, 'bola@test.local', 5);
SELECT tests.eq('the checkout remembers its organization and months',
  billing_checkout('finseka-ref-5') - 'amount', jsonb_build_object('org_id', :'org2'::uuid, 'months', 5));
SELECT tests.eq('an unknown reference finds nothing', billing_checkout('someone-else'), NULL::jsonb);
SELECT tests.fails('more than 12 months at once is refused',
  format('SELECT create_bachs_checkout(''finseka-ref-13'', %L, NULL, NULL, 13)', :'org2'), 'check');

SELECT tests.fails('a payment that covers fewer months is refused',
  'SELECT record_bachs_payment(''finseka-ref-5'', ''chk_1'', 20000, ''NGN'', now(), NULL)', 'does not cover');
SELECT tests.fails('another currency is refused',
  'SELECT record_bachs_payment(''finseka-ref-5'', ''chk_1'', 25000, ''USD'', now(), NULL)', 'does not cover');
SELECT record_bachs_payment('finseka-ref-5', 'chk_1', 25000, 'NGN', now(), NULL) AS paid \gset
SELECT tests.eq('five months are paid for, from today',
  (:'paid'::jsonb ->> 'covers_until')::timestamptz - now() BETWEEN interval '150 days' AND interval '154 days', true);
SELECT tests.eq('the same checkout is never counted twice',
  record_bachs_payment('finseka-ref-5', 'chk_1', 25000, 'NGN', now(), NULL) ->> 'duplicate', 'true');
SELECT create_bachs_checkout('finseka-ref-12', :'org2', :bola, 'bola@test.local', 12);
SELECT record_bachs_payment('finseka-ref-12', 'chk_2', 60000, 'NGN', now(), NULL) AS more \gset
SELECT tests.eq('a year paid later is added after the five months',
  (:'more'::jsonb ->> 'covers_from')::timestamptz, (:'paid'::jsonb ->> 'covers_until')::timestamptz);

SET LOCAL ROLE authenticated;
SELECT tests.as_user(:bola) \gset
SELECT tests.eq('Pro is active, with no automatic renewal',
  (app_context() -> 'billing' ->> 'status') || ' ' || (app_context() -> 'billing' ->> 'auto_renew'), 'active false');
SELECT tests.eq('both payments show in the billing history',
  (SELECT string_agg(provider || ':' || months, ',' ORDER BY months) FROM org_billing_payments()), 'bachs:5,bachs:12');
SELECT tests.fails('app users cannot start checkouts themselves',
  format('SELECT create_bachs_checkout(''x'', %L, NULL, NULL, 1)', :'org2'), 'permission denied');
SELECT tests.fails('or look them up',
  'SELECT billing_checkout(''finseka-ref-5'')', 'permission denied');
