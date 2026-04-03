-- =============================================================
-- RLS Verification Queries
-- =============================================================
-- Execute these in Lovable Cloud → Backend → Run SQL
-- to verify RLS policies are enforced correctly.
--
-- These queries simulate different auth contexts.
-- Replace UUIDs with real test data as needed.
-- =============================================================

-- TEST 1: Anon cannot write to protected tables
-- Expected: All should fail with RLS violation
-- Run as anon (no auth token):

-- INSERT INTO public.price_reports (user_id, product_id, region_id, price, unit)
-- VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 100, 'kg');
-- Expected: ERROR - violates row-level security policy

-- INSERT INTO public.alerts (user_id, product_id, alert_type)
-- VALUES (gen_random_uuid(), gen_random_uuid(), 'price_drop');
-- Expected: ERROR - violates row-level security policy

-- INSERT INTO public.moderation_actions (moderator_id, action_type)
-- VALUES (gen_random_uuid(), 'approve');
-- Expected: ERROR - violates row-level security policy

-- INSERT INTO public.audit_logs (action, table_name)
-- VALUES ('test', 'test');
-- Expected: ERROR - violates row-level security policy

-- TEST 2: Auth user can only insert own reports
-- (Run as authenticated user A)
-- INSERT INTO public.price_reports (user_id, product_id, region_id, price, unit)
-- VALUES (auth.uid(), '<valid_product_id>', '<valid_region_id>', 1500, 'kg');
-- Expected: SUCCESS

-- INSERT INTO public.price_reports (user_id, product_id, region_id, price, unit)
-- VALUES ('<other_user_id>', '<valid_product_id>', '<valid_region_id>', 1500, 'kg');
-- Expected: ERROR - violates row-level security policy

-- TEST 3: Users cannot read others' alerts
-- (Run as authenticated user A)
-- SELECT * FROM public.alerts WHERE user_id = auth.uid();
-- Expected: Only user A's alerts returned

-- SELECT * FROM public.alerts;
-- Expected: Only user A's alerts returned (RLS filters)

-- TEST 4: Moderator-only actions
-- (Run as authenticated user with 'user' role)
-- INSERT INTO public.moderation_actions (moderator_id, action_type)
-- VALUES (auth.uid(), 'approve');
-- Expected: ERROR - violates row-level security policy

-- (Run as authenticated user with 'moderator' role)
-- INSERT INTO public.moderation_actions (moderator_id, action_type, report_id)
-- VALUES (auth.uid(), 'approve', '<valid_report_id>');
-- Expected: SUCCESS

-- TEST 5: Audit logs - no client writes
-- (Run as any authenticated user, even admin)
-- INSERT INTO public.audit_logs (action, table_name)
-- VALUES ('manual_test', 'test');
-- Expected: ERROR - no INSERT policy exists

-- TEST 6: Constraint enforcement
-- INSERT INTO public.price_reports (user_id, product_id, region_id, price, unit)
-- VALUES (auth.uid(), '<valid_product_id>', '<valid_region_id>', -1, 'kg');
-- Expected: ERROR - violates check constraint "chk_price_range"

-- INSERT INTO public.report_votes (user_id, report_id, vote_type)
-- VALUES (auth.uid(), '<report_id>', 'up');
-- (Insert same again)
-- Expected: ERROR - violates unique constraint "uq_report_votes_user_report"
