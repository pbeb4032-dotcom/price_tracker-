
-- 1) Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2) Drop the existing public SELECT policy
DROP POLICY IF EXISTS "Profiles are publicly viewable" ON public.profiles;

-- 3) Create authenticated-only SELECT policy
CREATE POLICY "profiles_select_authenticated_only"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);
