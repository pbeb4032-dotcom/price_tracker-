
-- PATCH G: Alert processing function with cooldown + atomic last_triggered_at update
-- Additive only, reversible via DROP FUNCTION

create or replace function public.process_triggered_price_alerts(
  p_limit int default 200,
  p_cooldown_minutes int default 180
)
returns table (
  alert_id uuid,
  user_id uuid,
  product_id uuid,
  region_id uuid,
  target_price numeric,
  matched_price numeric,
  include_delivery boolean
)
language sql
security definer
set search_path = public
as $$
with candidates as (
  select
    a.id as alert_id,
    a.user_id,
    a.product_id,
    a.region_id,
    a.target_price,
    a.include_delivery,
    min(
      case
        when a.include_delivery
          then coalesce(o.final_price, 0) + coalesce(o.delivery_fee, 0)
        else coalesce(o.final_price, 0)
      end
    )::numeric as matched_price,
    a.last_triggered_at
  from public.alerts a
  join public.v_product_all_offers o
    on o.product_id = a.product_id
   and (a.region_id is null or o.region_id = a.region_id)
  where a.is_active = true
    and a.alert_type = 'price_drop'
    and coalesce(o.final_price, 0) > 0
  group by
    a.id, a.user_id, a.product_id, a.region_id,
    a.target_price, a.include_delivery, a.last_triggered_at
  having
    min(
      case
        when a.include_delivery
          then coalesce(o.final_price, 0) + coalesce(o.delivery_fee, 0)
        else coalesce(o.final_price, 0)
      end
    ) <= a.target_price
    and (
      a.last_triggered_at is null
      or now() - a.last_triggered_at >= make_interval(mins => p_cooldown_minutes)
    )
  order by matched_price asc
  limit greatest(p_limit, 1)
),
updated as (
  update public.alerts a
     set last_triggered_at = now()
    from candidates c
   where a.id = c.alert_id
  returning a.id
)
select
  c.alert_id, c.user_id, c.product_id, c.region_id,
  c.target_price, c.matched_price, c.include_delivery
from candidates c
join updated u on u.id = c.alert_id;
$$;

-- Only service_role can execute this
revoke all on function public.process_triggered_price_alerts(int, int) from public;
revoke all on function public.process_triggered_price_alerts(int, int) from anon;
revoke all on function public.process_triggered_price_alerts(int, int) from authenticated;
grant execute on function public.process_triggered_price_alerts(int, int) to service_role;
