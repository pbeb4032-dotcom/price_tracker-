-- Fair + null-safe claim RPC
-- - Excludes cooldown domains safely even when p_exclude_domains is NULL
-- - Applies per-domain claim cap
-- - Keeps backward compatibility with 1-arg signature

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
begin
  return query
  with params as (
    select
      greatest(coalesce(p_limit, 20), 1)::int as lim,
      greatest(coalesce(p_per_domain_limit, 5), 1)::int as per_domain_lim,
      coalesce(p_exclude_domains, '{}'::text[])::text[] as excluded
  ),
  eligible as (
    select
      cf.id,
      cf.discovered_at,
      cf.source_domain,
      row_number() over (
        partition by cf.source_domain
        order by cf.discovered_at asc, cf.id asc
      ) as rn
    from public.crawl_frontier cf
    cross join params p
    where cf.status = 'pending'
      and (cf.next_retry_at is null or cf.next_retry_at <= now())
      and cf.page_type in ('product','category','unknown')
      and not (cf.source_domain = any(p.excluded))
  ),
  picked as (
    select e.id
    from eligible e
    cross join params p
    where e.rn <= p.per_domain_lim
    order by e.discovered_at asc, e.id asc
    limit (select lim from params)
    for update of cf skip locked
  ),
  claimed as (
    update public.crawl_frontier cf
    set status = 'processing',
        updated_at = now()
    where cf.id in (select id from picked)
    returning cf.id, cf.url, cf.source_domain, cf.page_type, cf.depth
  )
  select claimed.id, claimed.url, claimed.source_domain, claimed.page_type, claimed.depth
  from claimed
  order by claimed.source_domain, claimed.id;
end;
$$;

-- Backward-compatible wrapper (old callers)
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