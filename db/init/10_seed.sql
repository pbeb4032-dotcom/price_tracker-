-- Seed minimal data for local standalone/dev.

BEGIN;

-- 1) Local admin user (admin@local / admin123) with fixed UUID for dev
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'admin@local', '{"display_name":"Admin"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email='admin@local');

-- Ensure profile
INSERT INTO public.profiles (user_id, display_name)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'Admin'
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id='00000000-0000-4000-8000-000000000001'::uuid);

-- Ensure admin role
INSERT INTO public.user_roles (user_id, role)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'admin'::public.app_role
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id='00000000-0000-4000-8000-000000000001'::uuid AND role='admin'::public.app_role
);

-- 2) Exchange rate baseline (seed one active row for today if missing)
-- FIX: include source_name because it's NOT NULL
INSERT INTO public.exchange_rates (source_type, source_name, rate_date, mid_iqd_per_usd, buy_iqd_per_usd, sell_iqd_per_usd, is_active)
SELECT 'market', 'Local Market', current_date, 1470, 1460, 1480, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.exchange_rates e
  WHERE e.source_type='market' AND e.rate_date = current_date
);

COMMIT;