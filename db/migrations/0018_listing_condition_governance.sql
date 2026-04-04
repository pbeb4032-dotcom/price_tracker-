-- Sprint 7 step 2: listing condition governance for publication gate

ALTER TABLE public.ingest_listing_candidates
  ADD COLUMN IF NOT EXISTS listing_condition text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS condition_confidence numeric(4,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS condition_policy text,
  ADD COLUMN IF NOT EXISTS condition_reason text,
  ADD COLUMN IF NOT EXISTS matched_section_policy_id uuid;

ALTER TABLE public.ingest_listing_candidates
  DROP CONSTRAINT IF EXISTS ingest_listing_candidates_listing_condition_check;

ALTER TABLE public.ingest_listing_candidates
  ADD CONSTRAINT ingest_listing_candidates_listing_condition_check
  CHECK (listing_condition in ('new', 'used', 'refurbished', 'open_box', 'unknown'));

ALTER TABLE public.ingest_decisions
  DROP CONSTRAINT IF EXISTS ingest_decisions_decision_type_check;

ALTER TABLE public.ingest_decisions
  ADD CONSTRAINT ingest_decisions_decision_type_check
  CHECK (decision_type in ('identity', 'taxonomy', 'price', 'condition', 'publication'));
