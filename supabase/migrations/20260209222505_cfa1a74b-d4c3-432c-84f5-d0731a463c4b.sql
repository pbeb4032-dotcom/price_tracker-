
-- R1-B: Add code column with unique constraint, then seed governorates

-- Step 1: Add code column
ALTER TABLE public.regions ADD COLUMN IF NOT EXISTS code text;

-- Step 2: Add unique constraint (not partial index)
ALTER TABLE public.regions ADD CONSTRAINT regions_code_unique UNIQUE (code);

-- Step 3: Idempotent upsert of 18 Iraqi governorates
INSERT INTO public.regions (code, name_ar, name_en, is_active)
VALUES
  ('BGD', 'بغداد', 'Baghdad', true),
  ('BSR', 'البصرة', 'Basra', true),
  ('NIN', 'نينوى', 'Nineveh', true),
  ('ERB', 'أربيل', 'Erbil', true),
  ('DHO', 'دهوك', 'Duhok', true),
  ('SUL', 'السليمانية', 'Sulaymaniyah', true),
  ('KRK', 'كركوك', 'Kirkuk', true),
  ('NJF', 'النجف', 'Najaf', true),
  ('KRB', 'كربلاء', 'Karbala', true),
  ('BBL', 'بابل', 'Babil', true),
  ('WAS', 'واسط', 'Wasit', true),
  ('DIY', 'ديالى', 'Diyala', true),
  ('SAL', 'صلاح الدين', 'Salah al-Din', true),
  ('ANB', 'الأنبار', 'Anbar', true),
  ('DQA', 'ذي قار', 'Dhi Qar', true),
  ('MYS', 'ميسان', 'Maysan', true),
  ('MUT', 'المثنى', 'Muthanna', true),
  ('QAD', 'القادسية', 'Al-Qadisiyyah', true)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  is_active = EXCLUDED.is_active,
  updated_at = now();
