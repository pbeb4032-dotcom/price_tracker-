
-- PATCH P: email_enabled preference
-- A) Add column
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS email_enabled boolean;

UPDATE public.user_settings SET email_enabled = true WHERE email_enabled IS NULL;

ALTER TABLE public.user_settings
  ALTER COLUMN email_enabled SET DEFAULT true,
  ALTER COLUMN email_enabled SET NOT NULL;

-- B) Unique index to prevent duplicate queue entries
CREATE UNIQUE INDEX IF NOT EXISTS email_notification_queue_notification_id_uidx
  ON public.email_notification_queue(notification_id);

-- C) Replace trigger function to honor email_enabled
CREATE OR REPLACE FUNCTION public.enqueue_email_for_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_email_enabled boolean := true;
BEGIN
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = NEW.user_id;
  IF v_email IS NULL THEN RETURN NEW; END IF;

  SELECT us.email_enabled INTO v_email_enabled
  FROM public.user_settings us WHERE us.user_id = NEW.user_id LIMIT 1;

  IF COALESCE(v_email_enabled, true) IS NOT TRUE THEN RETURN NEW; END IF;

  INSERT INTO public.email_notification_queue
    (user_id, notification_id, email_to, subject_ar, body_ar, payload)
  VALUES
    (NEW.user_id, NEW.id, v_email, NEW.title_ar, NEW.body_ar, NEW.payload)
  ON CONFLICT (notification_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_email_for_notification() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email_for_notification() TO service_role;

-- D) Recreate trigger
DROP TRIGGER IF EXISTS trg_enqueue_email_on_notification ON public.notifications;
CREATE TRIGGER trg_enqueue_email_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_email_for_notification();
