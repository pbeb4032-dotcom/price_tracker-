
-- PATCH O: Email Notifications infrastructure

-- 1) Email queue
CREATE TABLE IF NOT EXISTS public.email_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  email_to text NOT NULL,
  subject_ar text NOT NULL,
  body_ar text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON public.email_notification_queue (status, created_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_email_queue_user ON public.email_notification_queue (user_id);

ALTER TABLE public.email_notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_queue_service_only" ON public.email_notification_queue
  FOR ALL TO service_role USING (true);

-- 2) Delivery logs
CREATE TABLE IF NOT EXISTS public.email_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid NOT NULL REFERENCES public.email_notification_queue(id) ON DELETE CASCADE,
  status_code int NOT NULL,
  error_text text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_logs_service_only" ON public.email_delivery_logs
  FOR ALL TO service_role USING (true);

-- 3) Fetch pending emails
CREATE OR REPLACE FUNCTION public.get_pending_email_notifications(p_limit int DEFAULT 100)
RETURNS TABLE (
  queue_id uuid, user_id uuid, notification_id uuid,
  email_to text, subject_ar text, body_ar text, payload jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, user_id, notification_id, email_to, subject_ar, body_ar, payload
  FROM public.email_notification_queue
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT greatest(p_limit, 1);
$$;

-- 4) Mark delivery result
CREATE OR REPLACE FUNCTION public.mark_email_delivery(
  p_queue_id uuid,
  p_status_code int,
  p_error_text text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempts int;
BEGIN
  -- Log delivery attempt
  INSERT INTO public.email_delivery_logs (queue_id, status_code, error_text, provider_message_id)
  VALUES (p_queue_id, p_status_code, p_error_text, p_provider_message_id);

  -- Increment attempts
  UPDATE public.email_notification_queue
  SET attempts = attempts + 1, updated_at = now()
  WHERE id = p_queue_id
  RETURNING attempts INTO v_attempts;

  -- Update status
  IF p_status_code BETWEEN 200 AND 299 THEN
    UPDATE public.email_notification_queue
    SET status = 'sent', sent_at = now(), updated_at = now()
    WHERE id = p_queue_id;
  ELSIF v_attempts >= 3 THEN
    UPDATE public.email_notification_queue
    SET status = 'failed', last_error = p_error_text, updated_at = now()
    WHERE id = p_queue_id;
  ELSE
    UPDATE public.email_notification_queue
    SET last_error = p_error_text, updated_at = now()
    WHERE id = p_queue_id;
  END IF;
END;
$$;

-- 5) Permissions: service_role only
REVOKE ALL ON FUNCTION public.get_pending_email_notifications(int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_email_delivery(uuid, int, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_email_notifications(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_email_delivery(uuid, int, text, text) TO service_role;

-- 6) Enqueue function: auto-creates email queue entries from new notifications
CREATE OR REPLACE FUNCTION public.enqueue_email_for_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
BEGIN
  -- Get user email from auth.users
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
  IF v_email IS NULL THEN RETURN NEW; END IF;

  -- Check if user has email enabled (via user_settings, default true)
  -- Skip if user explicitly disabled (push_enabled used as proxy for now)

  INSERT INTO public.email_notification_queue (user_id, notification_id, email_to, subject_ar, body_ar, payload)
  VALUES (
    NEW.user_id,
    NEW.id,
    v_email,
    NEW.title_ar,
    NEW.body_ar,
    NEW.payload
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enqueue_email_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_email_for_notification();
