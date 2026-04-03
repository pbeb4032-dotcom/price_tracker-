
-- Add code column to products for idempotent upserts
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS code text;

-- Add unique constraint on code (idempotent via IF NOT EXISTS pattern)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_code_key'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_code_key UNIQUE (code);
  END IF;
END $$;

-- Seed baseline Iraqi market products (idempotent upsert by code)
INSERT INTO public.products (code, name_ar, name_en, category, unit, is_active) VALUES
  ('rice',       'رز',          'Rice',         'grains',     'kg',    true),
  ('wheat',      'حنطة',        'Wheat',        'grains',     'kg',    true),
  ('sugar',      'سكر',         'Sugar',        'essentials', 'kg',    true),
  ('flour',      'طحين',        'Flour',        'grains',     'kg',    true),
  ('cooking_oil','زيت طبخ',     'Cooking Oil',  'essentials', 'liter', true),
  ('tomato',     'طماطم',       'Tomato',       'vegetables', 'kg',    true),
  ('potato',     'بطاطا',       'Potato',       'vegetables', 'kg',    true),
  ('onion',      'بصل',         'Onion',        'vegetables', 'kg',    true),
  ('cucumber',   'خيار',        'Cucumber',     'vegetables', 'kg',    true),
  ('eggplant',   'باذنجان',     'Eggplant',     'vegetables', 'kg',    true),
  ('chicken',    'دجاج',        'Chicken',      'meat',       'kg',    true),
  ('lamb',       'لحم غنم',     'Lamb',         'meat',       'kg',    true),
  ('beef',       'لحم بقر',     'Beef',         'meat',       'kg',    true),
  ('eggs',       'بيض',         'Eggs',         'essentials', 'dozen', true),
  ('milk',       'حليب',        'Milk',         'dairy',      'liter', true),
  ('cheese',     'جبن',         'Cheese',       'dairy',      'kg',    true),
  ('bread',      'خبز',         'Bread',        'essentials', 'piece', true),
  ('tea',        'شاي',         'Tea',          'beverages',  'box',   true),
  ('lentils',    'عدس',         'Lentils',      'grains',     'kg',    true),
  ('chickpeas',  'حمص',         'Chickpeas',    'grains',     'kg',    true)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  category = EXCLUDED.category,
  unit = EXCLUDED.unit,
  is_active = true;
