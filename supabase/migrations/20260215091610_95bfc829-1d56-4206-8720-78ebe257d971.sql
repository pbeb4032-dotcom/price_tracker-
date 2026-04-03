
-- PATCH L: Web Push infrastructure
-- 1) User push subscriptions
CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_push_subs_user_active
  ON public.web_push_subscriptions (user_id, is_active);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wps_select_own" ON public.web_push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "wps_insert_own" ON public.web_push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wps_update_own" ON public.web_push_subscriptions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wps_delete_own" ON public.web_push_subscriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2) Delivery log
CREATE TABLE IF NOT EXISTS public.notification_push_deliveries (
  id bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.web_push_subscriptions(id) ON DELETE CASCADE,
  status_code int,
  error_text text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, subscription_id)
);

ALTER TABLE public.notification_push_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "npd_service_only" ON public.notification_push_deliveries
  FOR ALL TO service_role USING (true);

-- 3) push_sent_at marker on notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;

-- 4) DB functions for edge function
CREATE OR REPLACE FUNCTION public.get_pending_push_notifications(p_limit int DEFAULT 200)
RETURNS TABLE (
  notification_id uuid, subscription_id uuid, endpoint text,
  p256dh text, auth text, title_ar text, body_ar text, payload jsonb
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, s.id, s.endpoint, s.p256dh, s.auth, n.title_ar, n.body_ar, n.payload
  FROM public.notifications n
  JOIN public.web_push_subscriptions s ON s.user_id = n.user_id AND s.is_active = true
  WHERE n.push_sent_at IS NULL
  ORDER BY n.created_at ASC
  LIMIT greatest(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.mark_push_delivery(
  p_notification_id uuid, p_subscription_id uuid,
  p_status_code int, p_error_text text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notification_push_deliveries(notification_id, subscription_id, status_code, error_text)
  VALUES (p_notification_id, p_subscription_id, p_status_code, p_error_text)
  ON CONFLICT (notification_id, subscription_id) DO UPDATE
    SET status_code = excluded.status_code, error_text = excluded.error_text, sent_at = now();

  IF p_status_code BETWEEN 200 AND 299 THEN
    UPDATE public.notifications SET push_sent_at = coalesce(push_sent_at, now()) WHERE id = p_notification_id;
  END IF;

  IF p_status_code IN (404, 410) THEN
    UPDATE public.web_push_subscriptions SET is_active = false, updated_at = now() WHERE id = p_subscription_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_push_notifications(int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_push_delivery(uuid, uuid, int, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_push_notifications(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_push_delivery(uuid, uuid, int, text) TO service_role;

-- PATCH M: User settings
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY,
  push_enabled boolean NOT NULL DEFAULT false,
  notifications_unread_only boolean NOT NULL DEFAULT false,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text NOT NULL DEFAULT 'Asia/Baghdad',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_settings_select_own" ON public.user_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "user_settings_insert_own" ON public.user_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_settings_update_own" ON public.user_settings
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
