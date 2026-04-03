begin;

do $$
declare
  v_user uuid;
  v_notif uuid;
  v_queue_id uuid;
  v_count int;
begin
  select user_id into v_user from public.profiles order by created_at limit 1;
  if v_user is null then raise exception 'E2E: no users'; end if;

  -- Insert notification (trigger will auto-enqueue email)
  insert into public.notifications (user_id, type, title_ar, body_ar, payload)
  values (v_user, 'price_alert_triggered', 'E2E Email Test', 'Test body for email', '{"product_id":"p1"}'::jsonb)
  returning id into v_notif;

  -- Verify email was enqueued by trigger
  select id into v_queue_id
  from public.email_notification_queue
  where notification_id = v_notif and status = 'pending'
  limit 1;

  if v_queue_id is null then
    raise exception 'E2E: trigger did not enqueue email for notification %', v_notif;
  end if;

  -- Verify get_pending returns it
  select count(*) into v_count
  from public.get_pending_email_notifications(10) g
  where g.queue_id = v_queue_id;

  if v_count <> 1 then
    raise exception 'E2E: get_pending did not return queued email (count=%)', v_count;
  end if;

  -- Mark success
  perform public.mark_email_delivery(v_queue_id, 200, null, 'test-msg-id');

  -- Verify status = sent
  if not exists (
    select 1 from public.email_notification_queue where id = v_queue_id and status = 'sent' and sent_at is not null
  ) then
    raise exception 'E2E: queue row not marked as sent';
  end if;

  -- Verify delivery log
  if not exists (
    select 1 from public.email_delivery_logs where queue_id = v_queue_id and status_code = 200
  ) then
    raise exception 'E2E: delivery log missing';
  end if;

  -- Test retry logic: insert another, fail 3 times
  insert into public.email_notification_queue (user_id, notification_id, email_to, subject_ar, body_ar)
  values (v_user, v_notif, 'test@test.com', 'retry test', 'body')
  returning id into v_queue_id;

  perform public.mark_email_delivery(v_queue_id, 500, 'err1', null);
  perform public.mark_email_delivery(v_queue_id, 500, 'err2', null);
  perform public.mark_email_delivery(v_queue_id, 500, 'err3', null);

  if not exists (
    select 1 from public.email_notification_queue where id = v_queue_id and status = 'failed'
  ) then
    raise exception 'E2E: queue row not marked as failed after 3 attempts';
  end if;
end $$;

rollback;
