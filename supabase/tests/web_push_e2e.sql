begin;

do $$
declare
  v_user uuid;
  v_sub uuid;
  v_notif uuid;
  v_count int;
begin
  select user_id into v_user from public.profiles order by created_at limit 1;
  if v_user is null then raise exception 'E2E: no users'; end if;

  -- insert test subscription
  insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_user, 'https://test.push/e2e-' || gen_random_uuid(), 'test-p256dh', 'test-auth')
  returning id into v_sub;

  -- insert test notification
  insert into public.notifications (user_id, type, title_ar, body_ar, payload)
  values (v_user, 'price_alert_triggered', 'E2E Test', 'Test body', '{"product_id":"p1"}'::jsonb)
  returning id into v_notif;

  -- verify get_pending returns it
  select count(*) into v_count
  from public.get_pending_push_notifications(10) g
  where g.notification_id = v_notif and g.subscription_id = v_sub;

  if v_count <> 1 then
    raise exception 'E2E: get_pending did not return the test row (count=%)', v_count;
  end if;

  -- mark delivery
  perform public.mark_push_delivery(v_notif, v_sub, 201, null);

  -- verify push_sent_at set
  if not exists (
    select 1 from public.notifications where id = v_notif and push_sent_at is not null
  ) then
    raise exception 'E2E: push_sent_at not set after mark_push_delivery';
  end if;

  -- verify delivery log
  if not exists (
    select 1 from public.notification_push_deliveries
    where notification_id = v_notif and subscription_id = v_sub and status_code = 201
  ) then
    raise exception 'E2E: delivery log row missing';
  end if;

  -- test 410 deactivation
  perform public.mark_push_delivery(v_notif, v_sub, 410, 'gone');
  if exists (
    select 1 from public.web_push_subscriptions where id = v_sub and is_active = true
  ) then
    raise exception 'E2E: subscription not deactivated after 410';
  end if;
end $$;

rollback;
