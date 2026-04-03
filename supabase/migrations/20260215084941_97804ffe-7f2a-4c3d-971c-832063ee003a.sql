
-- PATCH H: notifications table + enqueue RPC

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null default 'price_alert_triggered',
  title_ar text not null,
  body_ar text not null,
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_read_created
  on public.notifications (user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
on public.notifications for select
to authenticated
using (auth.uid() = user_id);

create policy "notifications_update_own"
on public.notifications for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- service_role writes; authenticated reads/updates own
revoke insert, delete on table public.notifications from authenticated;
grant select, update on table public.notifications to authenticated;
grant all on table public.notifications to service_role;

-- Enqueue RPC: calls process_triggered + inserts notifications atomically
create or replace function public.enqueue_triggered_price_alert_notifications(
  p_limit int default 200,
  p_cooldown_minutes int default 180
)
returns table (
  notification_id uuid,
  alert_id uuid,
  user_id uuid,
  product_id uuid,
  matched_price numeric,
  target_price numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with triggered as (
    select * from public.process_triggered_price_alerts(p_limit, p_cooldown_minutes)
  ),
  inserted as (
    insert into public.notifications (user_id, type, title_ar, body_ar, payload)
    select
      t.user_id,
      'price_alert_triggered',
      'تنبيه سعر',
      format('انخفض السعر إلى %s د.ع (الهدف: %s د.ع)', coalesce(t.matched_price,0)::bigint, coalesce(t.target_price,0)::bigint),
      jsonb_build_object(
        'alert_id', t.alert_id,
        'user_id', t.user_id,
        'product_id', t.product_id,
        'region_id', t.region_id,
        'matched_price', t.matched_price,
        'target_price', t.target_price,
        'include_delivery', t.include_delivery,
        'triggered_at', now()
      )
    from triggered t
    returning id, payload
  )
  select
    i.id as notification_id,
    (i.payload->>'alert_id')::uuid as alert_id,
    (i.payload->>'user_id')::uuid as user_id,
    (i.payload->>'product_id')::uuid as product_id,
    (i.payload->>'matched_price')::numeric as matched_price,
    (i.payload->>'target_price')::numeric as target_price
  from inserted i;
end;
$$;

revoke all on function public.enqueue_triggered_price_alert_notifications(int, int) from public;
revoke all on function public.enqueue_triggered_price_alert_notifications(int, int) from anon;
revoke all on function public.enqueue_triggered_price_alert_notifications(int, int) from authenticated;
grant execute on function public.enqueue_triggered_price_alert_notifications(int, int) to service_role;
