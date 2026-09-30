-- Load-test data: many ordinary organizations, plus one very large one to time pages against.
--   * 10,000 small organizations: 40 members, a monthly due, a year of payments each.
--   * "Big Church": 5,000 members in 5 branches; monthly, weekly and daily dues; 10 compulsory
--     contributions; 20,000 manual ledger entries. Its rows go through every trigger (ledger
--     posting, audit log, period filling), exactly as when the app saves them.
SELECT setseed(0.42);

-- ---------------------------------------------------------------------------
-- Background organizations (triggers off: this is filler, loaded as fast as possible)
-- ---------------------------------------------------------------------------
SET session_replication_role = replica;
CREATE TEMP TABLE o AS
  SELECT gen_random_uuid() AS org_id, gen_random_uuid() AS uid, g AS n FROM generate_series(1, 10000) g;
INSERT INTO auth.users (id, email) SELECT uid, 'admin' || n || '@load.test' FROM o;
INSERT INTO organizations (id, name, created_by) SELECT org_id, 'Org ' || n, uid FROM o;
INSERT INTO profiles (id, org_id, full_name) SELECT uid, org_id, 'Admin ' || n FROM o;
INSERT INTO user_roles (user_id, org_id, role) SELECT uid, org_id, 'admin' FROM o;
INSERT INTO members (org_id, name, joined_on) SELECT org_id, 'Member ' || g, '2024-06-01' FROM o, generate_series(1, 40) g;
INSERT INTO dues (org_id, name, amount, frequency, starts_on)
  SELECT org_id, 'Monthly dues', 1000, 'monthly', '2025-01-01' FROM o;
INSERT INTO due_rates (org_id, due_id, amount, effective_from) SELECT org_id, id, 1000, '2025-01-01' FROM dues;
INSERT INTO due_payments (org_id, due_id, member_id, period_label, period_start, amount, channel, paid_at)
  SELECT m.org_id, d.id, m.id, to_char(p, 'Mon YYYY'), p::date, 1000, 'cash', p::date
  FROM members m JOIN dues d ON d.org_id = m.org_id,
       generate_series('2025-01-01'::date, '2025-12-01', '1 month') p;
SET session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Big Church (triggers on)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE big AS SELECT gen_random_uuid() AS org_id, gen_random_uuid() AS uid;
INSERT INTO auth.users (id, email) SELECT uid, 'bigchurch@load.test' FROM big;
SELECT set_config('request.jwt.claim.sub', uid::text, false) FROM big;  -- audit rows name this admin
INSERT INTO organizations (id, name, created_by) SELECT org_id, 'Big Church', uid FROM big;
INSERT INTO profiles (id, org_id, full_name) SELECT uid, org_id, 'Big Church Admin' FROM big;
INSERT INTO user_roles (user_id, org_id, role) SELECT uid, org_id, 'admin' FROM big;
INSERT INTO branches (org_id, name) SELECT org_id, 'Branch ' || g FROM big, generate_series(1, 5) g;

INSERT INTO members (org_id, branch_id, name, joined_on, tags)
SELECT big.org_id, b.ids[1 + g % 5], 'Church Member ' || g, '2023-01-01',
       CASE WHEN g % 3 = 0 THEN ARRAY['choir'] ELSE '{}' END
FROM big, generate_series(1, 5000) g,
     LATERAL (SELECT array_agg(id ORDER BY name) AS ids FROM branches WHERE org_id = big.org_id) b;

INSERT INTO dues (org_id, name, amount, frequency, starts_on, penalty_amount)
SELECT org_id, x.name, x.amount, x.freq::public.due_frequency, x.starts::date, x.penalty
FROM big, (VALUES ('Monthly dues', 1000, 'monthly', '2024-01-01', 200),
                  ('Weekly levy', 200, 'weekly', '2025-01-06', 0),
                  ('Daily contribution', 100, 'daily', '2026-01-01', 0)) x(name, amount, freq, starts, penalty);

-- Most people pay most periods: 80% monthly, 60% weekly, 50% daily.
INSERT INTO due_payments (org_id, due_id, member_id, amount, channel, paid_at)
SELECT d.org_id, d.id, m.id, d.amount, 'cash', p::date
FROM dues d JOIN big ON big.org_id = d.org_id
JOIN members m ON m.org_id = d.org_id
CROSS JOIN LATERAL generate_series(d.starts_on, current_date,
  CASE d.frequency WHEN 'monthly' THEN interval '1 month' WHEN 'weekly' THEN interval '1 week' ELSE interval '1 day' END) p
WHERE random() < CASE d.frequency WHEN 'monthly' THEN 0.8 WHEN 'weekly' THEN 0.6 ELSE 0.5 END;

INSERT INTO contributions (org_id, name, amount_per_person, mandatory, due_date)
SELECT org_id, 'Project ' || g, 5000, true, '2026-01-01'::date + g * 20 FROM big, generate_series(1, 10) g;
INSERT INTO contribution_members (org_id, contribution_id, member_id)
SELECT c.org_id, c.id, m.id FROM contributions c JOIN big ON big.org_id = c.org_id JOIN members m ON m.org_id = c.org_id;
INSERT INTO contribution_payments (org_id, contribution_id, member_id, amount, channel, paid_at)
SELECT cm.org_id, cm.contribution_id, cm.member_id, 5000, 'bank_transfer', '2026-06-01'
FROM contribution_members cm JOIN big ON big.org_id = cm.org_id
WHERE random() < 0.7;

INSERT INTO ledger_entries (org_id, kind, label, amount, entry_date, channel)
SELECT org_id, CASE WHEN g % 4 = 0 THEN 'income' ELSE 'expense' END::public.ledger_kind,
       'Manual entry ' || g, 1000 + g % 5000, '2024-01-01'::date + g % 1000, 'cash'
FROM big, generate_series(1, 20000) g;

-- Harder cases: a price rise, dues for the choir or one branch only (members outside them go
-- through the slower "has paid towards it" check), late joiners, part and voided payments.
INSERT INTO due_rates (org_id, due_id, amount, effective_from)
SELECT d.org_id, d.id, 1500, '2025-06-01' FROM dues d JOIN big ON big.org_id = d.org_id WHERE d.name = 'Monthly dues';
INSERT INTO dues (org_id, name, amount, frequency, starts_on, audience, audience_labels, audience_branch_ids,
                  penalty_amount, penalty_grace_days)
SELECT big.org_id, 'Choir levy', 300, 'weekly'::public.due_frequency, '2025-03-03'::date, 'labels'::public.due_audience, ARRAY['choir'], '{}'::uuid[], 50, 3 FROM big
UNION ALL
SELECT big.org_id, 'Branch building fund', 500, 'monthly'::public.due_frequency, '2025-01-01'::date, 'branches'::public.due_audience,
       '{}'::text[], ARRAY[(SELECT min(id::text)::uuid FROM branches WHERE org_id = big.org_id)], 0, 0 FROM big;
INSERT INTO due_payments (org_id, due_id, member_id, amount, channel, paid_at)
SELECT d.org_id, d.id, m.id, d.amount, 'pos', p::date
FROM dues d JOIN big ON big.org_id = d.org_id
JOIN members m ON m.org_id = d.org_id AND 'choir' = ANY (m.tags)
CROSS JOIN generate_series('2025-03-03'::date, current_date, '1 week') p
WHERE d.name = 'Choir levy' AND random() < 0.5;
UPDATE members SET joined_on = '2026-03-15'
WHERE id IN (SELECT m.id FROM members m JOIN big ON big.org_id = m.org_id ORDER BY m.id LIMIT 50);
INSERT INTO due_payments (org_id, due_id, member_id, amount, channel, paid_at)
SELECT d.org_id, d.id, m.id, 300, 'cash', '2025-08-10'
FROM dues d JOIN big ON big.org_id = d.org_id JOIN members m ON m.org_id = d.org_id
WHERE d.name = 'Monthly dues' AND random() < 0.04;
UPDATE due_payments SET voided_at = now(), void_reason = 'load test'
WHERE id IN (SELECT dp.id FROM due_payments dp JOIN dues d ON d.id = dp.due_id JOIN big ON big.org_id = d.org_id
             WHERE d.name = 'Weekly levy' ORDER BY dp.id LIMIT 800);

RESET request.jwt.claim.sub;
ANALYZE;

SELECT (SELECT count(*) FROM organizations) AS organizations,
       (SELECT count(*) FROM members) AS members,
       (SELECT count(*) FROM due_payments) AS due_payments,
       (SELECT count(*) FROM ledger_entries) AS ledger_rows,
       (SELECT count(*) FROM audit_log) AS audit_rows;
