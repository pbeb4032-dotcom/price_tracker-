import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * One-time non-destructive patch:
 * - Grocery taxonomy (products.subcategory + filtering)
 * - Category overrides (admin-managed)
 * - FX monitoring meta (exchange_rates.meta + samples)
 */
export async function patchTaxonomyOverridesSchema(env: Env): Promise<any> {
  const db = getDb(env);

  // 1) Products: subcategory + manual locks
  await db.execute(sql`
    alter table public.products
      add column if not exists subcategory text,
      add column if not exists category_manual boolean not null default false,
      add column if not exists subcategory_manual boolean not null default false,
      add column if not exists category_override_id uuid,
      add column if not exists subcategory_override_id uuid
  `).catch(() => {});

  await db.execute(sql`create index if not exists idx_products_subcategory on public.products(subcategory)`)
    .catch(() => {});

  // 2) Observations: store subcategory hints (best-effort)
  await db.execute(sql`
    alter table public.source_price_observations
      add column if not exists subcategory_hint text,
      add column if not exists subcategory_badge text,
      add column if not exists subcategory_confidence numeric(4,3),
      add column if not exists subcategory_conflict boolean,
      add column if not exists subcategory_evidence jsonb,
      add column if not exists category_override_id uuid,
      add column if not exists subcategory_override_id uuid
  `).catch(() => {});

  // 3) Category overrides table
  await db.execute(sql`
    create table if not exists public.category_overrides (
      id uuid primary key default gen_random_uuid(),
      match_kind text not null check (match_kind in ('source_id','domain','pattern')),
      match_value text not null,
      category text not null,
      subcategory text,
      priority int not null default 100,
      lock_category boolean not null default true,
      lock_subcategory boolean not null default true,
      is_active boolean not null default true,
      note text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `).catch(() => {});

  await db.execute(sql`create index if not exists idx_category_overrides_active on public.category_overrides(is_active, priority, created_at)`)
    .catch(() => {});

  // 4) FX monitoring meta + samples
  await db.execute(sql`alter table public.exchange_rates add column if not exists meta jsonb`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.exchange_rate_samples (
      id uuid primary key default gen_random_uuid(),
      rate_date date not null default current_date,
      source_type text not null check (source_type in ('gov','market')),
      source_name text not null,
      source_url text,
      hostname text,
      mid_iqd_per_usd numeric(12,4),
      ok boolean not null default true,
      error text,
      fetched_at timestamptz not null default now()
    )
  `).catch(() => {});

  await db.execute(sql`create index if not exists idx_fx_samples_date_type on public.exchange_rate_samples(rate_date, source_type, fetched_at desc)`)
    .catch(() => {});

  // 5) Search: allow filters.subcategory without changing signature.
  //    (If column is missing, this create/replace will fail; safe because we add column above.)
  await db.execute(sql`
    create or replace function public.search_products_live(
      p_query text,
      p_region_id uuid default null,
      p_filters jsonb default '{}'::jsonb,
      p_limit int default 24,
      p_offset int default 0,
      p_sort text default 'best'
    )
    returns table(
      product_id uuid, name_ar text, name_en text, image_url text,
      category text, best_price_iqd numeric, source_id uuid,
      source_name text, rank_score numeric
    )
    language sql stable
    set search_path to 'public', 'extensions'
    as $$
    with prm as (
      select
        public.normalize_ar_text(coalesce(p_query,'')) as q,
        public.expand_query_text(coalesce(p_query,'')) as qx,
        lower(coalesce(p_query,'')) as q_en,
        lower(public.expand_query_text(coalesce(p_query,''))) as qx_en,
        regexp_split_to_array(public.expand_query_text(coalesce(p_query,'')), '\\s+') as q_tokens,
        coalesce(nullif(trim(coalesce(p_filters->>'category','')), ''), '') as cat,
        coalesce(nullif(trim(coalesce(p_filters->>'subcategory','')), ''), '') as subcat,
        coalesce(nullif(regexp_replace(coalesce(p_filters->>'min_price_iqd',''),'[^0-9.]','','g'),'')::numeric, 0) as pmin,
        coalesce(nullif(regexp_replace(coalesce(p_filters->>'max_price_iqd',''),'[^0-9.]','','g'),'')::numeric, 999999999) as pmax
    ),
    offers as (
      select distinct on (o.product_id)
        o.product_id,
        o.normalized_price_iqd::numeric as best_price_iqd,
        o.source_id,
        coalesce(o.merchant_name, ps.name_ar, ps.domain) as source_name
      from public.source_price_observations o
      left join public.price_sources ps on ps.id = o.source_id
      where o.is_synthetic = false
        and o.normalized_price_iqd > 0
        and o.observed_at >= now() - interval '14 days'
        and (p_region_id is null or o.region_id = p_region_id)
      order by o.product_id, o.normalized_price_iqd asc, o.observed_at desc
    ),
    intent_flags as (
      select
        coalesce(max(case when i.intent='cheap' then i.boost end), 0)::numeric(8,4) as cheap_boost,
        coalesce(max(case when i.intent='best' then i.boost end), 0)::numeric(8,4) as best_boost,
        coalesce(max(case when i.intent='original' then i.boost end), 0)::numeric(8,4) as original_boost
      from public.search_intent_rules i cross join prm
      where i.is_active = true
        and (
          prm.q like '%' || public.normalize_ar_text(lower(i.alias)) || '%'
          or prm.q_en like '%' || lower(i.alias) || '%'
          or prm.qx like '%' || public.normalize_ar_text(lower(i.alias)) || '%'
          or prm.qx_en like '%' || lower(i.alias) || '%'
        )
    ),
    query_brands as (
      select b.alias, b.boost
      from public.search_brand_aliases b cross join prm
      where b.is_active = true
        and (
          prm.q like '%' || public.normalize_ar_text(lower(b.alias)) || '%'
          or prm.q_en like '%' || lower(b.alias) || '%'
          or prm.qx like '%' || public.normalize_ar_text(lower(b.alias)) || '%'
          or prm.qx_en like '%' || lower(b.alias) || '%'
        )
    ),
    brand_meta as (
      select
        count(*)::int as brand_cnt,
        coalesce(max(boost), 0)::numeric(8,4) as max_brand_boost
      from query_brands
    ),
    topic_flags as (
      select
        (
          prm.q ~ '(هاتف|جوال|موبايل|ايفون|جالاكسي|سمارتفون)'
          or prm.qx ~ '(هاتف|جوال|موبايل|ايفون|جالاكسي|سمارتفون)'
          or prm.q_en ~ '(phone|mobile|smartphone|iphone|galaxy)'
          or prm.qx_en ~ '(phone|mobile|smartphone|iphone|galaxy)'
        ) as is_phone_query
      from prm
    ),
    prod as (
      select
        p.id, p.name_ar, p.name_en, p.image_url, p.category, p.subcategory,
        public.normalize_ar_text(coalesce(p.name_ar,'')) as ar_norm,
        lower(coalesce(p.name_en,'')) as en_norm,
        (
          public.normalize_ar_text(coalesce(p.name_ar,'')) ~ '(هاتف|جوال|موبايل|ايفون|جالاكسي|سمارتفون)'
          or lower(coalesce(p.name_en,'')) ~ '(phone|mobile|smartphone|iphone|galaxy)'
        ) as is_phone_product
      from public.products p
      where p.is_active = true
    ),
    cand as (
      select
        p.id as product_id, p.name_ar, p.name_en, p.image_url, p.category,
        ofr.best_price_iqd, ofr.source_id, ofr.source_name,
        (
          greatest(
            extensions.similarity(p.ar_norm, prm.q),
            extensions.word_similarity(p.ar_norm, prm.q),
            case when prm.qx <> prm.q then extensions.similarity(p.ar_norm, prm.qx) else 0 end
          ) * 0.50
          + greatest(
              extensions.similarity(p.en_norm, prm.q_en),
              extensions.word_similarity(p.en_norm, prm.q_en),
              case when prm.qx_en <> prm.q_en then extensions.similarity(p.en_norm, prm.qx_en) else 0 end
            ) * 0.18
          + case when p.ar_norm = prm.q or p.en_norm = prm.q_en then 0.42 else 0 end
          + case when p.ar_norm like prm.q || '%' or p.en_norm like prm.q_en || '%' then 0.24 else 0 end
          + case when ofr.best_price_iqd is null then 0 else least(0.20, (30000.0 / nullif(ofr.best_price_iqd,0))) end
          + case when it.cheap_boost > 0 and ofr.best_price_iqd is not null
                then least(it.cheap_boost, (70000.0 / nullif(ofr.best_price_iqd,0))) else 0 end
          + case when it.best_boost > 0 and (
                  p.ar_norm = prm.q or p.en_norm = prm.q_en
                  or p.ar_norm like prm.q || '%' or p.en_norm like prm.q_en || '%')
                then it.best_boost else 0 end
          + case when it.original_boost > 0 and (
                  p.ar_norm ~ '(اصلي|اورجنال|وكاله|مضمون)'
                  or p.en_norm ~ '(original|genuine|authentic|oem)')
                then it.original_boost else 0 end
          + coalesce(br.brand_boost, 0)
          + least(0.14, coalesce(tk.tok_boost, 0))
          + case when tf.is_phone_query and p.is_phone_product then 0.12 else 0 end
          + case when tf.is_phone_query and not p.is_phone_product then -0.10 else 0 end
          + case
              when bm.brand_cnt > 0 and coalesce(br.brand_boost, 0) = 0
              then -least(0.14, 0.04 + bm.max_brand_boost)
              else 0
            end
        )::numeric(12,6) as rank_score
      from prod p
      cross join prm
      cross join intent_flags it
      cross join brand_meta bm
      cross join topic_flags tf
      left join offers ofr on ofr.product_id = p.id
      left join lateral (
        select coalesce(max(z.boost), 0)::numeric(8,4) as brand_boost
        from (
          select qb.boost,
                 public.normalize_ar_text(lower(qb.alias)) as alias_norm
          from query_brands qb
        ) z
        left join public.search_synonyms ss
          on ss.is_active = true
         and public.normalize_ar_text(lower(ss.alias)) = z.alias_norm
        where
          p.ar_norm like '%' || z.alias_norm || '%'
          or p.en_norm like '%' || z.alias_norm || '%'
          or (
            ss.canonical is not null and (
              p.ar_norm like '%' || public.normalize_ar_text(lower(ss.canonical)) || '%'
              or p.en_norm like '%' || lower(ss.canonical) || '%'
            )
          )
      ) br on true
      left join lateral (
        select coalesce(sum(
          case
            when length(tok) >= 3
             and tok !~ '^[0-9]+$'
             and lower(tok) not in ('cheap','cheapest','budget','best','original','top','premium','genuine','authentic','oem')
             and public.normalize_ar_text(lower(tok)) not in ('ارخص','رخيص','اقتصادي','افضل','احسن','اصلي','وكاله','مضمون')
             and (
               p.ar_norm like '%' || public.normalize_ar_text(lower(tok)) || '%'
               or p.en_norm like '%' || lower(tok) || '%'
             )
            then 0.028
            else 0
          end
        ),0)::numeric(8,4) as tok_boost
        from unnest(prm.q_tokens) as t(tok)
      ) tk on true
      where
        (
          p.ar_norm like '%' || prm.q || '%'
          or p.en_norm like '%' || prm.q_en || '%'
          or extensions.word_similarity(p.ar_norm, prm.q) >= 0.10
          or extensions.word_similarity(p.en_norm, prm.q_en) >= 0.10
          or (prm.qx <> prm.q and (
               p.ar_norm like '%' || prm.qx || '%'
               or p.en_norm like '%' || prm.qx_en || '%'
               or extensions.word_similarity(p.ar_norm, prm.qx) >= 0.10
               or extensions.word_similarity(p.en_norm, prm.qx_en) >= 0.10
          ))
          or coalesce(tk.tok_boost,0) >= 0.028
        )
        and (prm.cat = '' or coalesce(p.category,'') = prm.cat)
        and (prm.subcat = '' or coalesce(p.subcategory,'') = prm.subcat)
        and coalesce(ofr.best_price_iqd, 0) between prm.pmin and prm.pmax
        and (
          not tf.is_phone_query
          or p.is_phone_product
          or greatest(
               extensions.word_similarity(p.ar_norm, prm.q),
               extensions.word_similarity(p.en_norm, prm.q_en),
               case when prm.qx <> prm.q then extensions.word_similarity(p.ar_norm, prm.qx) else 0 end,
               case when prm.qx_en <> prm.q_en then extensions.word_similarity(p.en_norm, prm.qx_en) else 0 end
             ) >= 0.32
        )
    )
    select
      c.product_id, c.name_ar, c.name_en, c.image_url, c.category,
      c.best_price_iqd, c.source_id, c.source_name, c.rank_score
    from cand c
    order by
      case when p_sort='price_asc'  then c.best_price_iqd end asc nulls last,
      case when p_sort='price_desc' then c.best_price_iqd end desc nulls last,
      c.rank_score desc, c.best_price_iqd asc nulls last
    limit greatest(1, least(p_limit, 100))
    offset greatest(0, p_offset);
    $$
  `).catch(() => {});

  return { ok: true };
}
