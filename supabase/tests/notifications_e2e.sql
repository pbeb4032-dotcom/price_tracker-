begin;

do $$
declare
  v_user uuid;
  v_product uuid;
  v_region uuid;
  v_min_price numeric;
  v_alert uuid;
  v_before int;
  v_after int;
begin
  select user_id into v_user from public.profiles order by created_at limit 1;
  if v_user is null then raise exception 'E2E failed: no users in public.profiles'; end if;

  select o.product_id, o.region_id, min(coalesce(o.final_price, 0))::numeric
    into v_product, v_region, v_min_price
  from public.v_product_all_offers o
  where coalesce(o.final_price, 0) > 0
  group by o.product_id, o.region_id
  order by 3 asc limit 1;

  if v_product is null then raise exception 'E2E failed: no rows in v_product_all_offers'; end if;

  insert into public.alerts (user_id, product_id, region_id, target_price, include_delivery, is_active, alert_type)
  values (v_user, v_product, v_region, v_min_price + 10000, false, true, 'price_drop')
  returning id into v_alert;

  select count(*) into v_before from public.notifications n where (n.payload->>'alert_id')::uuid = v_alert;

  perform public.enqueue_triggered_price_alert_notifications(100, 0);

  select count(*) into v_after from public.notifications n where (n.payload->>'alert_id')::uuid = v_alert;

  if v_after <> v_before + 1 then
    raise exception 'E2E failed: expected 1 new notification. before=%, after=%', v_before, v_after;
  end if;

  if not exists (
    select 1 from public.notifications n
    where (n.payload->>'alert_id')::uuid = v_alert
      and n.type = 'price_alert_triggered'
      and n.user_id = v_user
  ) then
    raise exception 'E2E failed: notification payload/type mismatch';
  end if;
end $$;

rollback;
