-- Fix: FOR UPDATE SKIP LOCKED can't reference alias from different CTE
-- Use subquery approach instead

drop function if exists public.claim_crawl_frontier_batch(integer, text[], integer);
drop function if exists public.claim_crawl_frontier_batch(integer);

create or replace function public.claim_crawl_frontier_batch(
  p_limit int default 20,
  p_exclude_domains text[] default null,
  p_per_domain_limit int default 5
)
returns table(id uuid, url text, source_domain text, page_type text, depth integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim int := greatest(coalesce(p_limit, 20), 1);
  v_per int := greatest(coalesce(p_per_domain_limit, 5), 1);
  v_excluded text[] := coalesce(p_exclude_domains, '{}'::text[]);
begin
  return query
  with eligible as (
    select
      cf.id,
      cf.discovered_at,
      cf.source_domain,
      row_number() over (
        partition by cf.source_domain
        order by cf.discovered_at asc, cf.id asc
      ) as rn
    from public.crawl_frontier cf
    where cf.status = 'pending'
      and (cf.next_retry_at is null or cf.next_retry_at <= now())
      and cf.page_type in ('product','category','unknown')
      and not (cf.source_domain = any(v_excluded))
  ),
  picked as (
    select e.id
    from eligible e
    where e.rn <= v_per
    order by e.discovered_at asc, e.id asc
    limit v_lim
  ),
  locked as (
    select cf.id
    from public.crawl_frontier cf
    where cf.id in (select picked.id from picked)
    for update skip locked
  ),
  claimed as (
    update public.crawl_frontier cf
    set status = 'processing',
        updated_at = now()
    where cf.id in (select locked.id from locked)
    returning cf.id, cf.url, cf.source_domain, cf.page_type, cf.depth
  )
  select claimed.id, claimed.url, claimed.source_domain, claimed.page_type, claimed.depth
  from claimed
  order by claimed.source_domain, claimed.id;
end;
$$;

-- Backward-compatible wrapper
create or replace function public.claim_crawl_frontier_batch(p_limit int)
returns table(id uuid, url text, source_domain text, page_type text, depth integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select * from public.claim_crawl_frontier_batch(p_limit, null, 5);
end;
$$;

grant execute on function public.claim_crawl_frontier_batch(integer, text[], integer) to service_role;
grant execute on function public.claim_crawl_frontier_batch(integer) to service_role;