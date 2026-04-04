import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RTLLayout, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { RefreshCcw, DatabaseZap, Link2, Bug, PlayCircle, Activity, Wand2, Users, Bell } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/integrations/api/client';

type SourceKind = 'retailer' | 'marketplace' | 'official';

type SourcePack = { id: string; name_ar: string; description_ar?: string; file: string; count?: number; recommended?: boolean; tags?: string[] };
type SourceHealthReviewItem = {
  source_id?: string | null;
  domain?: string | null;
  source_name?: string | null;
  successes?: number | null;
  failures?: number | null;
  error_rate?: number | null;
  anomaly_rate?: number | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
};
type SourceCertificationReviewItem = {
  id: string;
  domain?: string | null;
  name_ar?: string | null;
  lifecycle_status?: string | null;
  validation_state?: string | null;
  certification_tier?: string | null;
  certification_status?: string | null;
  catalog_publish_enabled?: boolean | null;
  quality_score?: number | null;
  certification_reason?: string | null;
  error_rate?: number | null;
  anomaly_rate?: number | null;
};
type QuarantineItem = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'ignored' | string;
  product_name?: string | null;
  source_name?: string | null;
  source_domain?: string | null;
  product_url?: string | null;
  raw_price?: string | null;
  parsed_price?: number | null;
  currency?: string | null;
  reason_code?: string | null;
  reason_detail?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  review_note?: string | null;
};

type ListingConditionOverview = {
  hours: number;
  summary?: {
    total_candidates?: number;
    approved_candidates?: number;
    quarantined_candidates?: number;
    blocked_candidates?: number;
    new_candidates?: number;
    unknown_candidates?: number;
    used_candidates?: number;
    refurbished_candidates?: number;
    open_box_candidates?: number;
    mixed_without_allowlist_count?: number;
    section_policy_matched_count?: number;
  };
  reasons?: Array<{ reason_key: string; count: number }>;
  sources?: Array<{
    source_id?: string | null;
    source_domain?: string | null;
    source_name?: string | null;
    source_kind?: string | null;
    source_channel?: string | null;
    catalog_condition_policy?: string | null;
    total_candidates?: number;
    approved_candidates?: number;
    quarantined_candidates?: number;
    blocked_candidates?: number;
    unknown_candidates?: number;
    used_candidates?: number;
    refurbished_candidates?: number;
    open_box_candidates?: number;
    mixed_without_allowlist_count?: number;
    section_policy_matched_count?: number;
  }>;
};

type ListingConditionBlockedItem = {
  id: string;
  created_at?: string | null;
  source_id?: string | null;
  source_domain?: string | null;
  source_name?: string | null;
  source_kind?: string | null;
  source_channel?: string | null;
  catalog_condition_policy?: string | null;
  product_name?: string | null;
  source_url?: string | null;
  canonical_url?: string | null;
  category_hint?: string | null;
  subcategory_hint?: string | null;
  taxonomy_hint?: string | null;
  listing_condition?: string | null;
  condition_confidence?: number | null;
  condition_policy?: string | null;
  condition_reason?: string | null;
  publish_status?: string | null;
  publish_reason?: string | null;
  publish_reasons?: string[] | null;
  matched_section_policy_id?: string | null;
  section_key?: string | null;
  section_label?: string | null;
  section_url?: string | null;
  policy_scope?: string | null;
  section_condition_policy?: string | null;
  payload_excerpt?: string | null;
};

type SourceSectionPolicyAdmin = {
  id: string;
  source_id: string;
  source_name?: string | null;
  source_domain?: string | null;
  source_condition_policy?: string | null;
  section_key: string;
  section_label?: string | null;
  section_url?: string | null;
  policy_scope: 'allow' | 'block' | string;
  condition_policy: string;
  priority: number;
  is_active: boolean;
};

type SourcePackIndex = { version: string; generated_at: string; packs: SourcePack[] };

const DEFAULT_PRODUCT_REGEX = String.raw`\/(product|products|p|item|dp)\/`;
const DEFAULT_CATEGORY_REGEX = String.raw`\/(category|categories|collections|shop|store|department|c|offers)\/`;

function prettyJson(value: any) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

async function runJob(name: 'seed' | 'ingest' | 'apis' | 'images' | 'run_all') {
  switch (name) {
    case 'seed':
      return apiPost('/admin/jobs/seed', { limit: 5000, sitemapMaxPerDomain: 1500 });
    case 'ingest':
      return apiPost('/admin/jobs/ingest', { limit: 200, concurrency: 16, perDomain: 40 });
    case 'apis':
      return apiPost('/admin/jobs/apis', { maxPages: 6 });
    case 'images':
      return apiPost('/admin/jobs/images', { limit: 50 });
    case 'run_all':
      return apiPost('/admin/jobs/run_all', { ingestLimit: 50, imagesLimit: 10, maxPages: 3 });
  }
}

function normalizeScopeDomains(input: string): string[] {
  const raw = String(input ?? '').split(/[,\n\r\t ]+/g);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const domain = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/\/$/, '');
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

function buildScopeQueryString(pack: string, domainsInput: string): string {
  const params = new URLSearchParams();
  const domains = normalizeScopeDomains(domainsInput);
  if (pack && pack !== 'none') params.set('pack', pack);
  if (domains.length) params.set('domains', domains.join(','));
  return params.toString();
}

export default function AdminPage() {
  const qc = useQueryClient();
  const [pilotScopePack, setPilotScopePack] = useState<string>('none');
  const [pilotScopeDomains, setPilotScopeDomains] = useState<string>('');

  const buildPilotScopePayload = (extra: Record<string, unknown> = {}) => {
    const payload: Record<string, unknown> = { ...extra };
    const domains = normalizeScopeDomains(pilotScopeDomains);
    if (domains.length) payload.domains = domains;
    if (pilotScopePack && pilotScopePack !== 'none') payload.pack = pilotScopePack;
    return payload;
  };

  // ── Dashboard (RPC) ──
  const dashboard = useQuery({
    queryKey: ['admin', 'ingestion-dashboard'],
    queryFn: async () => {
      return apiGet<any>('/admin/dashboard');
    },
    staleTime: 30_000,
  });

  // ── Sources ──
  const sources = useQuery({
    queryKey: ['admin', 'price-sources'],
    queryFn: async () => {
      return (await apiGet<any[]>('/admin/price_sources')) ?? [];
    },
    staleTime: 30_000,
  });

  const addSource = useMutation({
    mutationFn: async (payload: {
      name_ar: string;
      domain: string;
      source_kind: SourceKind;
      trust_weight: number;
      base_url?: string | null;
      logo_url?: string | null;
      condition_policy?: string | null;
      condition_confidence?: number | null;
    }) => {
      return apiPost('/admin/price_sources', payload);
    },
    onSuccess: () => {
      toast.success('تمت إضافة المصدر');
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-overview'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل إضافة المصدر'),
  });

  const updateSource = useMutation({
    mutationFn: async (payload: { id: string; patch: Record<string, any> }) => {
      await apiPatch(`/admin/price_sources/${encodeURIComponent(payload.id)}`, payload.patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-overview'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-quarantine'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل التحديث'),
  });

  // ── Runs / Errors ──
  const runs = useQuery({
    queryKey: ['admin', 'ingestion-runs'],
    queryFn: async () => {
      return (await apiGet<any[]>('/admin/ingestion_runs')) ?? [];
    },
    staleTime: 15_000,
  });

  const errors = useQuery({
    queryKey: ['admin', 'ingestion-errors'],
    queryFn: async () => {
      return (await apiGet<any[]>('/admin/ingestion_errors')) ?? [];
    },
    staleTime: 15_000,
  });

  // ── Health monitor ──
// ── Shadow Mode + Source Discovery ──
  const [discoverTarget, setDiscoverTarget] = useState<number>(300);
  const [discoverSectors, setDiscoverSectors] = useState<string>('سوبرماركت,الكترونيات,صيدلية,ملابس,أجهزة منزلية');
  const [discoverProvinces, setDiscoverProvinces] = useState<string>('بغداد,البصرة,أربيل,النجف,كربلاء,الموصل,السليمانية');
  const [retroTagLimit, setRetroTagLimit] = useState<number>(200);
  const [retroTagDryRun, setRetroTagDryRun] = useState<boolean>(true);
  const [catalogTagDays, setCatalogTagDays] = useState<number>(90);
  const [catalogMinSamples, setCatalogMinSamples] = useState<number>(120);
  const [catalogDryRun, setCatalogDryRun] = useState<boolean>(true);

  const coverageStats = useQuery({
    queryKey: ['admin', 'coverage-stats'],
    queryFn: async () => apiGet<any>('/admin/coverage_stats?active=1'),
    staleTime: 30_000,
  });

  const missingProvinceTags = useQuery({
    queryKey: ['admin', 'missing-tags', 'provinces'],
    queryFn: async () => apiGet<any>('/admin/sources_missing_tags?kind=provinces&limit=60'),
    staleTime: 30_000,
  });

  const missingSectorTags = useQuery({
    queryKey: ['admin', 'missing-tags', 'sectors'],
    queryFn: async () => apiGet<any>('/admin/sources_missing_tags?kind=sectors&limit=60'),
    staleTime: 30_000,
  });

  const sectorReviewQueue = useQuery({
    queryKey: ['admin', 'sector-review-queue'],
    queryFn: async () => apiGet<any>('/admin/sector_review_queue?limit=80'),
    staleTime: 30_000,
  });

  const autoSectorCatalogStatus = useQuery({
    queryKey: ['admin', 'auto-sector-catalog-status'],
    queryFn: async () => apiGet<any>('/admin/auto_sector_catalog_status'),
    staleTime: 30_000,
  });

  const acceptSectorSuggestion = useMutation({
    mutationFn: async (payload: { id: string; sector?: string; mode?: 'merge' | 'replace' }) =>
      apiPost('/admin/jobs/accept_sector_catalog_suggestion', payload),
    onSuccess: () => {
      toast.success('تم اعتماد القطاع المقترح');
      qc.invalidateQueries({ queryKey: ['admin', 'sector-review-queue'] });
      qc.invalidateQueries({ queryKey: ['admin', 'coverage-stats'] });
      qc.invalidateQueries({ queryKey: ['admin', 'missing-tags', 'sectors'] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل اعتماد القطاع'),
  });

  const runAutoSectorCatalog = useMutation({
    mutationFn: async (payload: { force?: boolean }) => apiPost('/admin/jobs/auto_tag_sectors_catalog_daily', payload),
    onSuccess: (r: any) => {
      toast.success(`Auto sector tag: scanned ${r?.scanned ?? 0} • tagged ${r?.tagged ?? 0} • review ${r?.reviewQueued ?? 0}${r?.dryRun ? ' (dry-run)' : ''}`);
      qc.invalidateQueries({ queryKey: ['admin', 'auto-sector-catalog-status'] });
      qc.invalidateQueries({ queryKey: ['admin', 'sector-review-queue'] });
      qc.invalidateQueries({ queryKey: ['admin', 'coverage-stats'] });
      qc.invalidateQueries({ queryKey: ['admin', 'missing-tags', 'sectors'] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تشغيل Auto sector tagging'),
  });

  const retroTagJob = useMutation({
    mutationFn: async (payload: { limit: number; force?: boolean; dryRun?: boolean }) => apiPost('/admin/jobs/retro_tag_sources', payload),
    onSuccess: (r: any) => {
      toast.success(`Retro-tag: scanned ${r?.scanned ?? 0} • tagged ${r?.tagged ?? 0}${r?.dryRun ? ' (dry-run)' : ''}`);
      qc.invalidateQueries({ queryKey: ['admin', 'coverage-stats'] });
      qc.invalidateQueries({ queryKey: ['admin', 'missing-tags', 'provinces'] });
      qc.invalidateQueries({ queryKey: ['admin', 'missing-tags', 'sectors'] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Retro-tag'),
  });

  

  const catalogSectorsJob = useMutation({
    mutationFn: async (payload: { limit: number; days: number; minSamples: number; force?: boolean; dryRun?: boolean }) =>
      apiPost('/admin/jobs/retro_tag_sectors_catalog', payload),
    onSuccess: (r: any) => {
      toast.success(`Catalog sectors: scanned ${r?.scanned ?? 0} • tagged ${r?.tagged ?? 0}${r?.dryRun ? ' (dry-run)' : ''}`);
      qc.invalidateQueries({ queryKey: ['admin', 'coverage-stats'] });
      qc.invalidateQueries({ queryKey: ['admin', 'missing-tags', 'sectors'] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Tag sectors من الكاتالوك'),
  });

  const updateSourceTags = useMutation({
    mutationFn: async (payload: { id: string; provinces: string[]; sectors: string[]; mode?: 'merge' | 'replace' }) =>
      apiPatch(`/admin/price_sources/${encodeURIComponent(payload.id)}/tags`, {
        provinces: payload.provinces,
        sectors: payload.sectors,
        mode: payload.mode ?? 'replace',
      }),
    onSuccess: () => {
      toast.success('تم تحديث tags');
      qc.invalidateQueries({ queryKey: ['admin', 'coverage-stats'] });
      qc.invalidateQueries({ queryKey: ['admin', 'missing-tags', 'provinces'] });
      qc.invalidateQueries({ queryKey: ['admin', 'missing-tags', 'sectors'] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث tags'),
  });


  const sourceHealthLatest = useQuery({
    queryKey: ['admin', 'source-health-latest'],
    queryFn: async () => apiGet<any>(`/admin/source_health_latest`),
    staleTime: 30_000,
  });

  const rollupHealth = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/rollup_source_health', { hours: 24 }),
    onSuccess: () => {
      toast.success('تم تحديث ملخص الصحة');
      qc.invalidateQueries({ queryKey: ['admin', 'source-health-latest'] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث ملخص الصحة'),
  });

  const discoverSourcesJob = useMutation({
    mutationFn: async () =>
      apiPost('/admin/jobs/discover_sources', {
        target: discoverTarget,
        sectors: discoverSectors.split(',').map((s) => s.trim()).filter(Boolean),
        provinces: discoverProvinces.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: (r: any) => {
      toast.success(`تمت إضافة ${r?.inserted ?? 0} مصدر كـ Candidate`);
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل اكتشاف المصادر'),
  });

  const validateCandidatesJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/validate_candidates', buildPilotScopePayload({ limit: 200 })),
    onSuccess: (r: any) => {
      const scope = r?.pack ? ` • pack: ${r.pack}` : Array.isArray(r?.requested_domains) && r.requested_domains.length ? ` • domains: ${r.requested_domains.length}` : '';
      toast.success(`تم التحقق: ${r?.validated ?? 0} (Passed: ${r?.passed ?? 0})${scope}`);
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'scoped-source-certification'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل التحقق من المصادر'),
  });

  const activateCandidatesJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/activate_candidates', buildPilotScopePayload({ limit: 300, minScore: 0.7 })),
    onSuccess: (r: any) => {
      const scope = r?.pack ? ` • pack: ${r.pack}` : Array.isArray(r?.requested_domains) && r.requested_domains.length ? ` • domains: ${r.requested_domains.length}` : '';
      toast.success(`تم تفعيل ${r?.activated ?? 0} مصدر${scope}`);
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'scoped-source-certification'] });
      qc.invalidateQueries({ queryKey: ['admin', 'scoped-source-health'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تفعيل المصادر'),
  });

  const scopedSeedPilotJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/seed', buildPilotScopePayload({ limit: 500, sitemapMaxPerDomain: 200 })),
    onSuccess: (r: any) => {
      const seeded = Number(r?.result?.seeded_total ?? 0);
      toast.success(`تم Seed pilot: ${seeded} رابط`);
      qc.invalidateQueries({ queryKey: ['admin', 'ingestion-dashboard'] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-overview'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Seed pilot'),
  });

  const scopedIngestPilotJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/ingest', buildPilotScopePayload({ limit: 120, concurrency: 6, perDomain: 12 })),
    onSuccess: (r: any) => {
      const ok = Number(r?.result?.succeeded ?? 0);
      const fail = Number(r?.result?.failed ?? 0);
      toast.success(`تم Ingest pilot: ok ${ok} • fail ${fail}`);
      qc.invalidateQueries({ queryKey: ['admin', 'ingestion-dashboard'] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-overview'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-quarantine'] });
      qc.invalidateQueries({ queryKey: ['admin', 'scoped-taxonomy-quarantine'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Ingest pilot'),
  });

  const certifySourcesJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/certify_sources', buildPilotScopePayload({ hours: 72, limit: 500, apply: false })),
    onSuccess: (r: any) => {
      const scope = r?.pack ? ` • pack: ${r.pack}` : Array.isArray(r?.requested_domains) && r.requested_domains.length ? ` • domains: ${r.requested_domains.length}` : '';
      toast.success(`Certification dry-run: scanned ${r?.scanned ?? 0} • published ${r?.published ?? 0}${scope}`);
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'scoped-source-certification'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Certification dry-run'),
  });

  // ── Auto-Discovery (Daily) + Coverage ──
  const autoDiscoveryStatus = useQuery({
    queryKey: ['admin', 'auto-discovery-status'],
    queryFn: async () => apiGet<any>('/admin/auto_discovery_status'),
    staleTime: 30_000,
  });

  const patchAppSettingsSchemaJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/patch_app_settings_schema', {}),
    onSuccess: () => {
      toast.success('تم تطبيق Patch app_settings');
      qc.invalidateQueries({ queryKey: ['admin', 'auto-discovery-status'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Patch app_settings'),
  });

  const runAutoDiscoveryNow = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/auto_discovery_daily', { force: true }),
    onSuccess: (r: any) => {
      toast.success(`Auto-Discovery: inserted ${r?.totals?.inserted ?? r?.inserted ?? 0}, activated ${r?.totals?.activated ?? 0}`);
      qc.invalidateQueries({ queryKey: ['admin', 'auto-discovery-status'] });
      qc.invalidateQueries({ queryKey: ['admin', 'coverage-stats'] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Auto-Discovery'),
  });

  const fxUpdateDailyJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/fx_update_daily', {}),
    onSuccess: () => toast.success('تم تحديث سعر الصرف اليوم'),
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث سعر الصرف'),
  });

  // ── Category Overrides + Grocery taxonomy ──
  const categoryOverrides = useQuery({
    queryKey: ['admin', 'category-overrides'],
    queryFn: async () => (await apiGet<any[]>('/admin/category_overrides')) ?? [],
    staleTime: 20_000,
  });

  const [newOverride, setNewOverride] = useState<any>({
    match_kind: 'pattern',
    match_value: '',
    category: 'سوبرماركت',
    subcategory: null,
    priority: 100,
    lock_category: true,
    lock_subcategory: true,
    is_active: true,
    note: '',
  });

  const addOverride = useMutation({
    mutationFn: async (payload: any) => apiPost('/admin/category_overrides', payload),
    onSuccess: () => {
      toast.success('تمت إضافة Override');
      qc.invalidateQueries({ queryKey: ['admin', 'category-overrides'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل إضافة Override'),
  });

  const updateOverride = useMutation({
    mutationFn: async (payload: { id: string; patch: any }) => apiPatch(`/admin/category_overrides/${encodeURIComponent(payload.id)}`, payload.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'category-overrides'] }),
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث Override'),
  });

  const deleteOverride = useMutation({
    mutationFn: async (id: string) => apiDelete(`/admin/category_overrides/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success('تم الحذف');
      qc.invalidateQueries({ queryKey: ['admin', 'category-overrides'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل الحذف'),
  });

  const patchTaxonomySchemaJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/patch_taxonomy_overrides_schema', {}),
    onSuccess: () => toast.success('تم تطبيق Patch التصنيفات'),
    onError: (e: any) => toast.error(e?.message || 'فشل Patch التصنيفات'),
  });

  const backfillGrocerySubcatsJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/backfill_grocery_subcategories', { limit: 20000 }),
    onSuccess: (r: any) => toast.success(`تم تحديث ${r?.updated ?? r?.result?.updated ?? 0} منتج`),
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث التصنيف الفرعي'),
  });

  const applyOverridesJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/apply_category_overrides', { limit: 50000, force: false }),
    onSuccess: (r: any) => toast.success(`تم تطبيق Overrides على ${r?.updated ?? r?.result?.updated ?? 0} منتج`),
    onError: (e: any) => toast.error(e?.message || 'فشل تطبيق Overrides'),
  });



  // ── Taxonomy v2 (Review + Learning) ──
  const patchTaxonomyV2SchemaJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/patch_taxonomy_v2_schema', {}),
    onSuccess: () => toast.success('تم تطبيق Patch Taxonomy v2'),
    onError: (e: any) => toast.error(e?.message || 'فشل Patch Taxonomy v2'),
  });

  const seedTaxonomyV2Job = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/seed_taxonomy_v2', {}),
    onSuccess: (r: any) => toast.success(`تم Seed Taxonomy v2 (${r?.total_nodes ?? r?.upserted ?? 0} nodes)`),
    onError: (e: any) => toast.error(e?.message || 'فشل Seed Taxonomy v2'),
  });

  const backfillTaxonomyV2Job = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/backfill_taxonomy_v2', { limit: 5000 }),
    onSuccess: (r: any) => toast.success(`تم Backfill: updated ${r?.updated ?? 0} • quarantine ${r?.quarantined ?? 0}`),
    onError: (e: any) => toast.error(e?.message || 'فشل Backfill Taxonomy v2'),
  });

  type TaxonomyNode = { key: string; parent_key: string | null; label_ar: string | null; label_en: string | null; synonyms?: string[] | null; is_leaf?: boolean | null };
  type TaxonomyQuarantineItem = {
    id: string;
    status: 'pending' | 'approved' | 'rejected' | string;
    product_id?: string | null;
    domain?: string | null;
    url?: string | null;
    product_name?: string | null;
    site_category_raw?: string | null;
    inferred_taxonomy_key?: string | null;
    chosen_taxonomy_key?: string | null;
    confidence?: number | null;
    reason?: string | null;
    conflict?: boolean | null;
    conflict_reason?: string | null;
    reviewer_note?: string | null;
    created_at?: string | null;
  };

  type CategoryConflictItem = {
    id: string;
    status: 'open' | 'resolved' | 'ignored' | string;
    product_id?: string | null;
    product_name_ar?: string | null;
    product_name_en?: string | null;
    current_category?: string | null;
    suggested_category?: string | null;
    site_category_raw?: string | null;
    signal_site?: string | null;
    signal_domain?: string | null;
    signal_text_score?: number | null;
    review_note?: string | null;
    decided_category?: string | null;
    evidence?: any;
    seen_count?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
  };

  const taxonomyV2Nodes = useQuery({
    queryKey: ['admin', 'taxonomy-v2-nodes'],
    queryFn: async () => (await apiGet<any>('/admin/taxonomy_v2/nodes')) as { ok: boolean; nodes: TaxonomyNode[]; table_ready?: boolean },
    staleTime: 60_000,
  });

  const [taxV2Status, setTaxV2Status] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [taxV2Search, setTaxV2Search] = useState<string>('');
  const [taxNodeSearch, setTaxNodeSearch] = useState<string>('');
  const [taxSelectedKey, setTaxSelectedKey] = useState<string | null>(null);
  const [taxApplyMappingDefault, setTaxApplyMappingDefault] = useState<boolean>(true);
  const [taxNotes, setTaxNotes] = useState<Record<string, string>>({});
  const [taxSelectedIds, setTaxSelectedIds] = useState<Record<string, boolean>>({});
  const [taxExpanded, setTaxExpanded] = useState<Record<string, boolean>>({});
  const [taxBulkBusy, setTaxBulkBusy] = useState<boolean>(false);

  const taxonomyV2Quarantine = useQuery({
    queryKey: ['admin', 'taxonomy-v2-quarantine', taxV2Status],
    queryFn: async () => (await apiGet<any>(`/admin/taxonomy_v2/quarantine?status=${taxV2Status}&limit=50`)) as { ok: boolean; items: TaxonomyQuarantineItem[]; table_ready?: boolean },
    staleTime: 8_000,
  });

  const reviewTaxonomyV2 = useMutation({
    mutationFn: async (payload: { id: string; status: 'approved' | 'rejected' | 'pending'; taxonomy_key?: string | null; apply_mapping?: boolean; note?: string | null }) => {
      return apiPost(`/admin/taxonomy_v2/quarantine/${encodeURIComponent(payload.id)}/review`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'taxonomy-v2-quarantine'] });
      qc.invalidateQueries({ queryKey: ['admin', 'taxonomy-v2-nodes'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل المراجعة'),
  });


  const [categoryConflictStatus, setCategoryConflictStatus] = useState<'open' | 'resolved' | 'ignored' | 'all'>('open');
  const [categoryConflictSearch, setCategoryConflictSearch] = useState<string>('');
  const [categoryConflictNotes, setCategoryConflictNotes] = useState<Record<string, string>>({});
  const [categoryConflictDecisions, setCategoryConflictDecisions] = useState<Record<string, string>>({});

  const categoryConflicts = useQuery({
    queryKey: ['admin', 'category-conflicts', categoryConflictStatus, categoryConflictSearch],
    queryFn: async () => {
      const qs = new URLSearchParams({
        status: categoryConflictStatus,
        limit: '60',
      });
      if (categoryConflictSearch.trim()) qs.set('q', categoryConflictSearch.trim());
      return (await apiGet<any>(`/admin/category_conflicts?${qs.toString()}`)) as { ok: boolean; items: CategoryConflictItem[]; total?: number };
    },
    staleTime: 10_000,
  });

  const reviewCategoryConflict = useMutation({
    mutationFn: async (payload: { id: string; status: 'open' | 'resolved' | 'ignored'; decided_category?: string | null; note?: string | null; apply_to_product?: boolean }) => {
      return apiPost(`/admin/category_conflicts/${encodeURIComponent(payload.id)}/review`, payload);
    },
    onSuccess: () => {
      toast.success('تم تحديث تعارض التصنيف');
      qc.invalidateQueries({ queryKey: ['admin', 'category-conflicts'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث تعارض التصنيف'),
  });


  const normLite = (s: any) => String(s ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();

  const taxNodes = (taxonomyV2Nodes.data?.nodes ?? []) as TaxonomyNode[];

  const taxNodeByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const n of taxNodes) {
      m.set(n.key, { ...n, children: [] as any[] });
    }
    for (const n of taxNodes) {
      const parent = n.parent_key ? m.get(n.parent_key) : null;
      if (parent) parent.children.push(m.get(n.key));
    }
    // Sort children by Arabic label then key
    for (const v of m.values()) {
      v.children.sort((a: any, b: any) => {
        const la = String(a.label_ar ?? a.label_en ?? a.key);
        const lb = String(b.label_ar ?? b.label_en ?? b.key);
        return la.localeCompare(lb, 'ar');
      });
    }
    return m;
  }, [taxNodes]);

  const taxTreeRoots = useMemo(() => {
    const roots: any[] = [];
    for (const n of taxNodes) {
      if (!n.parent_key || !taxNodeByKey.get(n.parent_key)) roots.push(taxNodeByKey.get(n.key));
    }
    roots.sort((a: any, b: any) => String(a.label_ar ?? a.label_en ?? a.key).localeCompare(String(b.label_ar ?? b.label_en ?? b.key), 'ar'));
    return roots;
  }, [taxNodes, taxNodeByKey]);

  const taxNodeMatches = useMemo(() => {
    const q = normLite(taxNodeSearch);
    if (!q) return [] as any[];
    const out: any[] = [];
    for (const n of taxNodes) {
      const hay = [n.key, n.label_ar, n.label_en, ...(n.synonyms ?? [])].map(normLite).join(' | ');
      if (hay.includes(q)) out.push(n);
    }
    return out.slice(0, 40);
  }, [taxNodes, taxNodeSearch]);

  const taxQuarantineItems = (taxonomyV2Quarantine.data?.items ?? []) as TaxonomyQuarantineItem[];
  const taxFilteredQuarantine = useMemo(() => {
    const q = normLite(taxV2Search);
    if (!q) return taxQuarantineItems;
    return taxQuarantineItems.filter((it) => {
      const hay = [it.product_name, it.domain, it.url, it.site_category_raw, it.inferred_taxonomy_key, it.chosen_taxonomy_key, it.reason].map(normLite).join(' | ');
      return hay.includes(q);
    });
  }, [taxQuarantineItems, taxV2Search]);

  const taxSelectedCount = useMemo(() => Object.values(taxSelectedIds).filter(Boolean).length, [taxSelectedIds]);

  const taxAllVisibleSelected = useMemo(() => {
    const ids = taxFilteredQuarantine.map((x) => x.id);
    if (ids.length === 0) return false;
    return ids.every((id) => Boolean(taxSelectedIds[id]));
  }, [taxFilteredQuarantine, taxSelectedIds]);

  const toggleSelectAllVisible = (checked: boolean) => {
    setTaxSelectedIds((prev) => {
      const next = { ...prev };
      for (const it of taxFilteredQuarantine) next[it.id] = checked;
      return next;
    });
  };

  const bulkReviewTaxonomy = async (action: 'approve_inferred' | 'approve_selected' | 'reject') => {
    const ids = Object.entries(taxSelectedIds).filter(([, v]) => v).map(([id]) => id).slice(0, 50);
    if (ids.length === 0) {
      toast.error('اختر عناصر أولاً');
      return;
    }
    setTaxBulkBusy(true);
    try {
      for (const id of ids) {
        const it = taxQuarantineItems.find((x) => x.id === id);
        if (!it) continue;
        const note = (taxNotes[id] ?? '').trim() || null;
        if (action === 'reject') {
          await apiPost(`/admin/taxonomy_v2/quarantine/${encodeURIComponent(id)}/review`, { id, status: 'rejected', note });
        } else if (action === 'approve_selected') {
          if (!taxSelectedKey) throw new Error('choose taxonomy key first');
          await apiPost(`/admin/taxonomy_v2/quarantine/${encodeURIComponent(id)}/review`, { id, status: 'approved', taxonomy_key: taxSelectedKey, apply_mapping: taxApplyMappingDefault, note });
        } else {
          const inferred = it.inferred_taxonomy_key ?? null;
          if (!inferred) continue;
          await apiPost(`/admin/taxonomy_v2/quarantine/${encodeURIComponent(id)}/review`, { id, status: 'approved', taxonomy_key: inferred, apply_mapping: taxApplyMappingDefault, note });
        }
      }
      toast.success(`تم تنفيذ Bulk على ${ids.length} عنصر`);
      setTaxSelectedIds({});
      qc.invalidateQueries({ queryKey: ['admin', 'taxonomy-v2-quarantine'] });
    } catch (e: any) {
      toast.error(e?.message || 'فشل Bulk');
    } finally {
      setTaxBulkBusy(false);
    }
  };


  const renderTaxNode = (node: any, level = 0): any => {
    if (!node) return null;
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const expanded = taxExpanded[node.key] ?? (level <= 0);

    return (
      <div key={node.key} className="select-none">
        <div className="flex items-center gap-2 py-1" style={{ paddingRight: level * 14 }}>
          {hasChildren ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={() => setTaxExpanded((p) => ({ ...p, [node.key]: !expanded }))}
            >
              {expanded ? '−' : '+'}
            </Button>
          ) : (
            <div className="w-[40px]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{node.label_ar || node.label_en || node.key}</div>
            <div className="text-[11px] text-muted-foreground truncate">{node.key}</div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={taxSelectedKey === node.key ? 'default' : 'secondary'}
            className="h-7"
            onClick={() => setTaxSelectedKey(node.key)}
          >
            اختيار
          </Button>
        </div>
        {hasChildren && expanded ? (
          <div className="pr-2">
            {node.children.map((ch: any) => renderTaxNode(ch, level + 1))}
          </div>
        ) : null}
      </div>
    );
  };
  const sourceHealth = useQuery({
    queryKey: ['admin', 'source-health', 24],
    queryFn: async () => apiGet<any>(`/admin/source_health?hours=24`),
    staleTime: 15_000,
  });

  const patchSourceHealthSchema = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/patch_source_auto_disable_schema', {}),
    onSuccess: () => {
      toast.success('تم تطبيق Patch Health/Auto-Disable');
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Patch الصحة'),
  });

  const runHealthScan = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/health_scan', { hours: 24 }),
    onSuccess: () => {
      toast.success('تم فحص الصحة');
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل فحص الصحة'),
  });

  const overrideSourceHealth = useMutation({
    mutationFn: async (payload: { domain: string; action: 'enable' | 'disable'; minutes?: number; reason?: string }) =>
      apiPost('/admin/source_health_override', payload),
    onSuccess: (r: any) => {
      toast.success(r?.action === 'enable' ? 'تم تفعيل المصدر' : 'تم تعطيل المصدر مؤقتاً');
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث حالة المصدر'),
  });

  // ── Recover Probe Queue ──
  const probeQueueStats = useQuery({
    queryKey: ['admin', 'probe-queue-stats', 24],
    queryFn: async () => apiGet<any>(`/admin/probe_queue_stats?hours=24`),
    staleTime: 15_000,
  });

  const patchProbeQueueSchemaJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/patch_probe_queue_schema', {}),
    onSuccess: () => {
      toast.success('تم تطبيق Probe Queue Schema');
      qc.invalidateQueries({ queryKey: ['admin', 'probe-queue-stats', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Patch probe queue'),
  });

  const seedProbeQueueJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/seed_probe_queue', { limitDomains: 200 }),
    onSuccess: (r: any) => {
      const n = Array.isArray(r?.queued_domains) ? r.queued_domains.length : Number(r?.queued ?? 0);
      toast.success(`تم إدخال ${n} دومين إلى Probe Queue`);
      qc.invalidateQueries({ queryKey: ['admin', 'probe-queue-stats', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل seed probe queue'),
  });

  const runProbeQueueJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/run_probe_queue', { limit: 50, concurrency: 2 }),
    onSuccess: (r: any) => {
      toast.success(`Probes: ok ${Number(r?.succeeded ?? 0)} • fail ${Number(r?.failed ?? 0)}`);
      qc.invalidateQueries({ queryKey: ['admin', 'probe-queue-stats', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل run probe queue'),
  });

  // ── Render Queue (Playwright Worker) ──
  const renderQueueStats = useQuery({
    queryKey: ['admin', 'render-queue-stats', 24],
    queryFn: async () => apiGet<any>(`/admin/render_queue_stats?hours=24`),
    staleTime: 15_000,
  });

  const patchRenderQueueSchemaJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/patch_render_queue_schema', {}),
    onSuccess: () => {
      toast.success('تم تطبيق Render Queue Schema');
      qc.invalidateQueries({ queryKey: ['admin', 'render-queue-stats', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل Patch render queue'),
  });

  const seedRenderQueueJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/seed_render_queue', { limit: 2000 }),
    onSuccess: (r: any) => {
      toast.success(`تم إدخال ${Number(r?.inserted ?? 0)} URL إلى Render Queue`);
      qc.invalidateQueries({ queryKey: ['admin', 'render-queue-stats', 24] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل seed render queue'),
  });

  const cleanupRenderCacheJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/cleanup_render_cache', { maxAgeDays: 7 }),
    onSuccess: (r: any) => {
      toast.success(`Cleanup: cache ${Number(r?.deleted_cache ?? 0)} • queue ${Number(r?.deleted_queue ?? 0)}`);
      qc.invalidateQueries({ queryKey: ['admin', 'render-queue-stats', 24] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل cleanup render cache'),
  });

  const rebalanceRenderQueueJob = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/rebalance_render_queue_priorities', { limit: 20000 }),
    onSuccess: (r: any) => {
      toast.success(`Rebalance: updated ${Number(r?.updated ?? 0)}`);
      qc.invalidateQueries({ queryKey: ['admin', 'render-queue-stats', 24] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل rebalance priorities'),
  });

  const resetRenderHealthJob = useMutation({
    mutationFn: async (domain: string) => apiPost('/admin/jobs/reset_render_health', { domain }),
    onSuccess: (r: any) => {
      toast.success(`تم تصفير Render health لـ ${String(r?.domain ?? '') || 'الدومين'}`);
      qc.invalidateQueries({ queryKey: ['admin', 'render-queue-stats', 24] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل reset render health'),
  });

  const [renderBudgetEdits, setRenderBudgetEdits] = useState<Record<string, number>>({});
  const [renderTtlEdits, setRenderTtlEdits] = useState<Record<string, number>>({});
  const [renderStaleEdits, setRenderStaleEdits] = useState<Record<string, number>>({});
  const [jsOnlyBudgetQuery, setJsOnlyBudgetQuery] = useState<string>('');


// ── Alerts dispatch (price alerts → notifications) ──
const dispatchPriceAlerts = useMutation({
  mutationFn: async () => apiPost('/admin/jobs/dispatch_price_alerts', { limit: 200, cooldown_minutes: 180 }),
  onSuccess: (r: any) => {
    const inserted = Number(r?.result?.inserted ?? 0);
    toast.success(`تم توليد ${inserted} إشعار`);
    qc.invalidateQueries({ queryKey: ['admin', 'ingestion-dashboard'] });
  },
  onError: (e: any) => toast.error(e?.message || 'فشل توليد الإشعارات'),
});

// ── Trust graph recompute ──
const recomputeTrust = useMutation({
  mutationFn: async () => apiPost('/admin/jobs/recompute_trust', { hours: 168 }),
  onSuccess: (r: any) => {
    const updated = Number(r?.result?.updated ?? 0);
    toast.success(`تم تحديث الثقة لـ ${updated} مصدر`);
    qc.invalidateQueries({ queryKey: ['admin', 'source-health', 24] });
    qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
  },
  onError: (e: any) => toast.error(e?.message || 'فشل حساب الثقة'),
});
// ── Crowd signals ──
  const offerReports = useQuery({
    queryKey: ['admin', 'offer-reports'],
    queryFn: async () => apiGet<any>(`/admin/offer_reports?limit=50`),
    staleTime: 10_000,
  });

  const applyOfferReports = useMutation({
    mutationFn: async () => apiPost('/admin/jobs/apply_offer_reports', { days: 30 }),
    onSuccess: () => {
      toast.success('تم تطبيق البلاغات على العروض');
      qc.invalidateQueries({ queryKey: ['admin', 'offer-reports'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تطبيق البلاغات'),
  });

  // ── Smart import URL ──
  const [smartUrl, setSmartUrl] = useState<string>('');
  const [smartResult, setSmartResult] = useState<any>(null);
  const smartImport = useMutation({
    mutationFn: async () => apiPost('/admin/smart_import_url', { url: smartUrl }),
    onSuccess: (r: any) => {
      setSmartResult(r);
      toast.success('تمت إضافة الرابط');
      qc.invalidateQueries({ queryKey: ['admin', 'site-plugins'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل الاستيراد'),
  });

  // ── Site Plugins (view) ──
  const plugins = useQuery({
    queryKey: ['admin', 'site-plugins'],
    queryFn: async () => {
      return (await apiGet<any[]>('/admin/site_plugins')) ?? [];
    },
    staleTime: 30_000,
  });

  // ── Actions ──
  const action = useMutation({
    mutationFn: async (name: string) => {
      switch (name) {
        case 'seed':
          return runJob('seed');
        case 'ingest':
          return runJob('ingest');
        case 'apis':
          return runJob('apis');
        case 'images':
          return runJob('images');
        case 'refresh':
          return runJob('run_all');
        default:
          throw new Error('Unknown action');
      }
    },
    onSuccess: () => {
      toast.success('تم التنفيذ');
      qc.invalidateQueries({ queryKey: ['admin', 'ingestion-dashboard'] });
      qc.invalidateQueries({ queryKey: ['admin', 'ingestion-runs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'ingestion-errors'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل التنفيذ'),
  });

  const [newSource, setNewSource] = useState({
    name_ar: '',
    domain: '',
    source_kind: 'retailer' as SourceKind,
    trust_weight: 0.6,
    base_url: '',
    logo_url: '',
    condition_policy: 'unknown',
    condition_confidence: 0.5,
  });

  const [listingConditionHours, setListingConditionHours] = useState<number>(72);
  const [listingConditionReason, setListingConditionReason] = useState<string>('all');
  const [listingConditionSourceId, setListingConditionSourceId] = useState<string>('all');
  const [sectionPolicySourceId, setSectionPolicySourceId] = useState<string>('all');
  const [newSectionPolicy, setNewSectionPolicy] = useState({
    section_key: '',
    section_label: '',
    section_url: '',
    policy_scope: 'allow',
    condition_policy: 'new_only',
    priority: 100,
  });

  const listingConditionOverview = useQuery({
    queryKey: ['admin', 'listing-condition-overview', listingConditionHours, pilotScopePack, pilotScopeDomains],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('hours', String(listingConditionHours));
      params.set('limit_sources', '30');
      const scope = buildScopeQueryString(pilotScopePack, pilotScopeDomains);
      if (scope) {
        const scoped = new URLSearchParams(scope);
        scoped.forEach((value, key) => params.set(key, value));
      }
      return apiGet<ListingConditionOverview>(`/admin/listing_condition/overview?${params.toString()}`);
    },
    staleTime: 15_000,
  });

  const listingConditionBlocked = useQuery({
    queryKey: ['admin', 'listing-condition-quarantine', listingConditionHours, listingConditionReason, listingConditionSourceId, pilotScopePack, pilotScopeDomains],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('hours', String(listingConditionHours));
      params.set('limit', '50');
      if (listingConditionReason !== 'all') params.set('reason', listingConditionReason);
      if (listingConditionSourceId !== 'all') params.set('source_id', listingConditionSourceId);
      const scope = buildScopeQueryString(pilotScopePack, pilotScopeDomains);
      if (scope) {
        const scoped = new URLSearchParams(scope);
        scoped.forEach((value, key) => params.set(key, value));
      }
      const res = await apiGet<{ items?: ListingConditionBlockedItem[] }>(`/admin/listing_condition/quarantine?${params.toString()}`);
      return Array.isArray(res?.items) ? res.items : [];
    },
    staleTime: 10_000,
  });

  const sourceSectionPolicies = useQuery({
    queryKey: ['admin', 'source-section-policies', sectionPolicySourceId],
    queryFn: async () => {
      if (!sectionPolicySourceId || sectionPolicySourceId === 'all') return [];
      const res = await apiGet<{ items?: SourceSectionPolicyAdmin[] }>(
        `/admin/source_section_policies?source_id=${encodeURIComponent(sectionPolicySourceId)}&limit=100`,
      );
      return Array.isArray(res?.items) ? res.items : [];
    },
    enabled: Boolean(sectionPolicySourceId && sectionPolicySourceId !== 'all'),
    staleTime: 10_000,
  });

  const saveSectionPolicy = useMutation({
    mutationFn: async (payload: {
      source_id: string;
      section_key: string;
      section_label?: string | null;
      section_url?: string | null;
      policy_scope: 'allow' | 'block';
      condition_policy: string;
      priority: number;
    }) => apiPost('/admin/source_section_policies', payload),
    onSuccess: () => {
      toast.success('تم حفظ سياسة القسم');
      qc.invalidateQueries({ queryKey: ['admin', 'source-section-policies'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-overview'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-quarantine'] });
      setNewSectionPolicy({
        section_key: '',
        section_label: '',
        section_url: '',
        policy_scope: 'allow',
        condition_policy: 'new_only',
        priority: 100,
      });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل حفظ سياسة القسم'),
  });

  const patchSectionPolicy = useMutation({
    mutationFn: async (payload: { id: string; patch: Record<string, any> }) =>
      apiPatch(`/admin/source_section_policies/${encodeURIComponent(payload.id)}`, payload.patch),
    onSuccess: () => {
      toast.success('تم تحديث سياسة القسم');
      qc.invalidateQueries({ queryKey: ['admin', 'source-section-policies'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-overview'] });
      qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-quarantine'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث سياسة القسم'),
  });

  // ── Plugin tools ──
  const [pluginDomain, setPluginDomain] = useState<string>('');
  const [pluginJson, setPluginJson] = useState<string>('');
  const [testUrl, setTestUrl] = useState<string>('');
  const [testResult, setTestResult] = useState<any>(null);
  const [quarantineStatusFilter, setQuarantineStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'ignored' | 'all'>('pending');
  const [quarantineReviewNotes, setQuarantineReviewNotes] = useState<Record<string, string>>({});

  const quarantineItems = useQuery({
    queryKey: ['admin', 'price-anomaly-quarantine', quarantineStatusFilter],
    queryFn: async () => {
      const res = await apiGet<{ items?: QuarantineItem[]; table_ready?: boolean }>(`/admin/price_anomaly_quarantine?status=${quarantineStatusFilter}&limit=50`);
      return {
        items: Array.isArray(res?.items) ? res.items : [],
        tableReady: res?.table_ready !== false,
      };
    },
    staleTime: 10_000,
  });

  const reviewQuarantine = useMutation({
    mutationFn: async (payload: { id: string; status: 'approved' | 'rejected' | 'ignored' | 'pending'; restoreObservation?: boolean }) => {
      const note = quarantineReviewNotes[payload.id]?.trim();
      return apiPost(`/admin/price_anomaly_quarantine/${payload.id}/review`, {
        status: payload.status,
        review_note: note || null,
        restoreObservation: Boolean(payload.restoreObservation),
      });
    },
    onSuccess: (res: any) => {
      const restore = res?.restore;
      if (res?.restore_requested) {
        if (restore?.ok) {
          toast.success(restore?.duplicate ? 'تم الاعتماد (السعر موجود مسبقًا)' : 'تم الاعتماد واسترجاع السعر للمشاهدات');
        } else {
          toast.success(`تم تحديث الحالة (تعذر الاسترجاع: ${restore?.skipped_reason || 'غير معروف'})`);
        }
      } else {
        toast.success('تم تحديث حالة العنصر');
      }
      qc.invalidateQueries({ queryKey: ['admin', 'price-anomaly-quarantine'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تحديث المراجعة'),
  });

  // ── Source Packs (offline JSON bundles) ──
  const sourcePacksIndex = useQuery({
    queryKey: ['admin', 'source-packs-index'],
    queryFn: async () => {
      const res = await fetch(`/source-packs/index.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load source packs (${res.status})`);
      return (await res.json()) as SourcePackIndex;
    },
    staleTime: 0,
  });

  const pilotScopeQuery = useMemo(() => buildScopeQueryString(pilotScopePack, pilotScopeDomains), [pilotScopePack, pilotScopeDomains]);
  const hasPilotScope = Boolean(pilotScopeQuery);
  const selectedPilotPack = useMemo(
    () => (sourcePacksIndex.data?.packs ?? []).find((pack) => pack.id === pilotScopePack) ?? null,
    [sourcePacksIndex.data, pilotScopePack],
  );

  const scopedSourceCertification = useQuery({
    queryKey: ['admin', 'scoped-source-certification', pilotScopeQuery],
    queryFn: async () => apiGet<{ items?: SourceCertificationReviewItem[] }>(`/admin/source_certification?limit=200${pilotScopeQuery ? `&${pilotScopeQuery}` : ''}`),
    enabled: hasPilotScope,
    staleTime: 15_000,
  });

  const scopedSourceHealth = useQuery({
    queryKey: ['admin', 'scoped-source-health', pilotScopeQuery],
    queryFn: async () => apiGet<{ sources?: SourceHealthReviewItem[] }>(`/admin/source_health_latest${pilotScopeQuery ? `?${pilotScopeQuery}` : ''}`),
    enabled: hasPilotScope,
    staleTime: 15_000,
  });

  const scopedTaxonomyQuarantine = useQuery({
    queryKey: ['admin', 'scoped-taxonomy-quarantine', taxV2Status, pilotScopeQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('status', taxV2Status);
      params.set('limit', '50');
      if (pilotScopeQuery) {
        const scoped = new URLSearchParams(pilotScopeQuery);
        scoped.forEach((value, key) => params.set(key, value));
      }
      return apiGet<{ ok: boolean; items: TaxonomyQuarantineItem[]; table_ready?: boolean }>(`/admin/taxonomy_v2/quarantine?${params.toString()}`);
    },
    enabled: hasPilotScope,
    staleTime: 10_000,
  });

  const certificationItems = (scopedSourceCertification.data?.items ?? []) as SourceCertificationReviewItem[];
  const healthItems = (scopedSourceHealth.data?.sources ?? []) as SourceHealthReviewItem[];
  const taxonomyItems = (scopedTaxonomyQuarantine.data?.items ?? []) as TaxonomyQuarantineItem[];

  const packReviewVerdict = useMemo(() => {
    if (!hasPilotScope) {
      return {
        status: 'idle' as const,
        reasons: ['اختر pack أو domains حتى يظهر review الحقيقي.'],
      };
    }

    const publishedCount = certificationItems.filter((item) => ['published', 'anchor'].includes(String(item.certification_tier ?? ''))).length;
    const sandboxCount = certificationItems.filter((item) => String(item.certification_tier ?? '') === 'sandbox').length;
    const mixedBlocked = Number(listingConditionOverview.data?.summary?.mixed_without_allowlist_count ?? 0);
    const unknownCount = Number(listingConditionOverview.data?.summary?.unknown_candidates ?? 0);
    const totalCandidates = Number(listingConditionOverview.data?.summary?.total_candidates ?? 0);
    const unknownRate = totalCandidates > 0 ? unknownCount / totalCandidates : 0;
    const highErrorSources = healthItems.filter((item) => Number(item.error_rate ?? 0) >= 0.2).length;
    const taxonomyPending = taxonomyItems.length;

    const stopReasons: string[] = [];
    if (!certificationItems.length) stopReasons.push('بعد ماكو مصادر ضمن الـ scope الحالي أو بعد ما انزرعت/تفعّلت.');
    if (mixedBlocked > 0) stopReasons.push(`أكو ${mixedBlocked} listing من mixed sources بدون allowlist نظيف.`);
    if (unknownRate >= 0.2) stopReasons.push(`unknown condition عالي: ${(unknownRate * 100).toFixed(1)}%.`);
    if (highErrorSources > 0) stopReasons.push(`أكو ${highErrorSources} مصدر عنده error_rate عالي.`);
    if (taxonomyPending > 15) stopReasons.push(`taxonomy quarantine مرتفعة: ${taxonomyPending}.`);
    if (sandboxCount > publishedCount && certificationItems.length > 0) stopReasons.push('عدد sandbox أعلى من published/anchor داخل الحزمة.');

    if (stopReasons.length) return { status: 'stop' as const, reasons: stopReasons };
    return {
      status: 'go' as const,
      reasons: ['الوضع الحالي نظيف بما يكفي للانتقال إلى batch أو pilot أوسع مع نفس الحوكمة.'],
    };
  }, [
    certificationItems,
    hasPilotScope,
    healthItems,
    listingConditionOverview.data,
    taxonomyItems,
  ]);

  const [packProgress, setPackProgress] = useState<{ packId: string | null; done: number; total: number; errors: number }>({
    packId: null,
    done: 0,
    total: 0,
    errors: 0,
  });

	 const installPack = useMutation({
	  mutationFn: async (pack: any) => {
	    setPackProgress({ packId: pack.id, done: 0, total: 0, errors: 0 });
	    const res = await fetch(`/source-packs/${pack.file}`);
	    if (!res.ok) throw new Error(`فشل تحميل الحزمة (${res.status})`);
	    const json = await res.json();
	    const plugins = Array.isArray(json.plugins) ? json.plugins : [];
	    setPackProgress({ packId: pack.id, done: 0, total: plugins.length, errors: 0 });

	    let done = 0;
	    let errors = 0;
	
	    // API expects: { plugin, mode }
	    for (const plugin of plugins) {
	      try {
	        await apiPost('/admin/site_plugins/import', { plugin, mode: 'merge' });
	        done += 1;
	      } catch {
	        errors += 1;
	      } finally {
	        setPackProgress({ packId: pack.id, done, total: plugins.length, errors });
	      }
	    }

	    if (errors) throw new Error(`فشل تنصيب ${errors} من ${plugins.length}`);
	    return { done, total: plugins.length, errors };
	  },
	  onSuccess: () => {
	    toast.success('تم تنصيب الحزمة بنجاح');
	    qc.invalidateQueries({ queryKey: ['admin', 'site-plugins'] });
	    qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
	  },
	  onError: (e: any) => {
	    toast.error(e?.message || 'فشل تنصيب الحزمة');
	  },
	});

  const loadPlugin = useMutation({
    mutationFn: async (domain: string) => {
      return apiPost('/admin/site_plugins/export', { domain });
    },
    onSuccess: (d: any) => {
      setPluginJson(prettyJson(d?.plugin ?? d));
      toast.success('تم تحميل البلجن');
    },
    onError: (e: any) => toast.error(e?.message || 'فشل تحميل البلجن'),
  });

  const importPlugin = useMutation({
    mutationFn: async (payload: { plugin: any; mode?: 'replace' | 'merge' }) => {
      return apiPost('/admin/site_plugins/import', payload);
    },
    onSuccess: () => {
      toast.success('تم استيراد البلجن');
      qc.invalidateQueries({ queryKey: ['admin', 'site-plugins'] });
      qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل استيراد البلجن'),
  });

  const testPlugin = useMutation({
    mutationFn: async (payload: { url: string; domain?: string }) => {
      return apiPost('/admin/site_plugins/test', payload);
    },
    onSuccess: (d: any) => {
      setTestResult(d);
      toast.success('تم الاختبار');
    },
    onError: (e: any) => toast.error(e?.message || 'فشل الاختبار'),
  });

  const dashboardCards = useMemo(() => {
    const d = dashboard.data ?? {};
    return [
      { label: 'منتجات', value: d.total_products ?? 0 },
      { label: 'ملاحظات حقيقية 24h', value: d.real_observations_24h ?? 0 },
      { label: 'صور موثّقة', value: d.verified_images ?? 0 },
      { label: 'عروض موثوقة', value: d.trusted_offers ?? 0 },
      { label: 'Frontier فاشلة', value: d.failed_frontier_items ?? 0 },
    ];
  }, [dashboard.data]);

  return (
    <RTLLayout>
      <PageContainer className="py-10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="font-display text-3xl font-bold">الإدارة</h1>
          <Button
            variant="outline"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['admin', 'ingestion-dashboard'] });
              qc.invalidateQueries({ queryKey: ['admin', 'price-sources'] });
              qc.invalidateQueries({ queryKey: ['admin', 'ingestion-runs'] });
              qc.invalidateQueries({ queryKey: ['admin', 'ingestion-errors'] });
              qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-overview'] });
              qc.invalidateQueries({ queryKey: ['admin', 'listing-condition-quarantine'] });
              qc.invalidateQueries({ queryKey: ['admin', 'source-section-policies'] });
            }}
            className="gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            تحديث
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          {dashboardCards.map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">{c.label}</div>
                <div className="text-2xl font-bold">{String(c.value)}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="sources" className="w-full">
          <TabsList className="grid grid-cols-4 md:grid-cols-8 md:w-[1120px]">
            <TabsTrigger value="sources" className="gap-2">
              <Link2 className="h-4 w-4" />
              المصادر
            </TabsTrigger>
            <TabsTrigger value="plugins" className="gap-2">
              <DatabaseZap className="h-4 w-4" />
              البلجنات
            </TabsTrigger>
            <TabsTrigger value="jobs" className="gap-2">
              <PlayCircle className="h-4 w-4" />
              تشغيل
            </TabsTrigger>
            <TabsTrigger value="errors" className="gap-2">
              <Bug className="h-4 w-4" />
              أخطاء
            </TabsTrigger>
            <TabsTrigger value="health" className="gap-2">
              <Activity className="h-4 w-4" />
              الصحة
            </TabsTrigger>
            <TabsTrigger value="smart" className="gap-2">
              <Wand2 className="h-4 w-4" />
              استيراد URL
            </TabsTrigger>
            <TabsTrigger value="categories" className="gap-2">
              <Wand2 className="h-4 w-4" />
              التصنيفات
            </TabsTrigger>
            <TabsTrigger value="crowd" className="gap-2">
              <Users className="h-4 w-4" />
              بلاغات
            </TabsTrigger>
          </TabsList>

          {/* SOURCES */}
          <TabsContent value="sources" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">إضافة مصدر جديد</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>اسم بالعربي</Label>
                  <Input
                    value={newSource.name_ar}
                    onChange={(e) => setNewSource((p) => ({ ...p, name_ar: e.target.value }))}
                    placeholder="مثال: مسواك"
                  />
                </div>
                <div className="space-y-2">
                  <Label>الدومين</Label>
                  <Input
                    value={newSource.domain}
                    onChange={(e) => setNewSource((p) => ({ ...p, domain: e.target.value }))}
                    placeholder="miswag.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>نوع المصدر</Label>
                  <Select
                    value={newSource.source_kind}
                    onValueChange={(v) => setNewSource((p) => ({ ...p, source_kind: v as SourceKind }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retailer">متجر</SelectItem>
                      <SelectItem value="marketplace">ماركت بليس</SelectItem>
                      <SelectItem value="official">رسمي</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>سياسة الحالة</Label>
                  <Select
                    value={newSource.condition_policy}
                    onValueChange={(v) => setNewSource((p) => ({ ...p, condition_policy: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new_only">new_only</SelectItem>
                      <SelectItem value="mixed">mixed</SelectItem>
                      <SelectItem value="unknown">unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>الثقة (0 - 1)</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={newSource.trust_weight}
                    onChange={(e) => setNewSource((p) => ({ ...p, trust_weight: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Condition confidence</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={newSource.condition_confidence}
                    onChange={(e) => setNewSource((p) => ({ ...p, condition_confidence: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Base URL (اختياري)</Label>
                  <Input
                    value={newSource.base_url}
                    onChange={(e) => setNewSource((p) => ({ ...p, base_url: e.target.value }))}
                    placeholder="https://miswag.com/ar"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Logo URL (اختياري)</Label>
                  <Input
                    value={newSource.logo_url}
                    onChange={(e) => setNewSource((p) => ({ ...p, logo_url: e.target.value }))}
                    placeholder="https://.../logo.png"
                  />
                </div>

                <div className="md:col-span-2">
                  <Button
                    className="w-full gap-2"
                    disabled={addSource.isPending || !newSource.name_ar || !newSource.domain}
                    onClick={() =>
                      addSource.mutate({
                        name_ar: newSource.name_ar,
                        domain: newSource.domain,
                        source_kind: newSource.source_kind,
                        trust_weight: newSource.trust_weight,
                        base_url: newSource.base_url || null,
                        logo_url: newSource.logo_url || null,
                        condition_policy: newSource.condition_policy || null,
                        condition_confidence: Number.isFinite(newSource.condition_confidence) ? newSource.condition_confidence : null,
                      })
                    }
                  >
                    <DatabaseZap className="h-4 w-4" />
                    إضافة + توليد إعدادات افتراضية
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">المصادر الحالية</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(sources.data ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">لا توجد مصادر بعد.</div>
                ) : (
                  (sources.data ?? []).map((s) => (
                    <div key={s.id} className="flex flex-col gap-3 border border-border rounded-lg p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">{s.name_ar}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.domain} • {s.source_kind}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {Boolean((s as any).auto_disabled) && (
                            <Badge variant="destructive" title={String((s as any).auto_disabled_reason ?? '')}>
                              Auto-Disabled
                            </Badge>
                          )}
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">مفعّل</Label>
                            <Switch
                              checked={Boolean(s.is_active)}
                              onCheckedChange={(v) => updateSource.mutate({ id: s.id, patch: { is_active: v } })}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs">الثقة</Label>
                          <Input
                            type="number"
                            step="0.05"
                            min={0}
                            max={1}
                            defaultValue={Number(s.trust_weight ?? 0.5)}
                            onBlur={(e) => {
                              const v = Number((e.target as HTMLInputElement).value);
                              if (Number.isFinite(v)) updateSource.mutate({ id: s.id, patch: { trust_weight: v } });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Condition policy</Label>
                          <Select
                            value={String((s as any).catalog_condition_policy ?? 'unknown')}
                            onValueChange={(v) => updateSource.mutate({ id: s.id, patch: { catalog_condition_policy: v } })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="new_only">new_only</SelectItem>
                              <SelectItem value="mixed">mixed</SelectItem>
                              <SelectItem value="unknown">unknown</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Condition confidence</Label>
                          <Input
                            type="number"
                            step="0.05"
                            min={0}
                            max={1}
                            defaultValue={Number((s as any).condition_confidence ?? 0.5)}
                            onBlur={(e) => {
                              const v = Number((e.target as HTMLInputElement).value);
                              if (Number.isFinite(v)) updateSource.mutate({ id: s.id, patch: { condition_confidence: v } });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Base URL</Label>
                          <Input
                            defaultValue={s.base_url ?? ''}
                            onBlur={(e) =>
                              updateSource.mutate({
                                id: s.id,
                                patch: { base_url: (e.target as HTMLInputElement).value || null },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Logo URL</Label>
                          <Input
                            defaultValue={s.logo_url ?? ''}
                            onBlur={(e) =>
                              updateSource.mutate({
                                id: s.id,
                                patch: { logo_url: (e.target as HTMLInputElement).value || null },
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">حوكمة المنتجات الجديدة فقط</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-2">
                    <Label>نافذة القياس (ساعة)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={720}
                      value={listingConditionHours}
                      onChange={(e) => setListingConditionHours(Number(e.target.value))}
                      className="w-[140px]"
                    />
                  </div>
                  <Button variant="outline" onClick={() => {
                    listingConditionOverview.refetch();
                    listingConditionBlocked.refetch();
                  }}>
                    تحديث
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                  {[
                    { label: 'إجمالي candidates', value: listingConditionOverview.data?.summary?.total_candidates ?? 0 },
                    { label: 'Approved', value: listingConditionOverview.data?.summary?.approved_candidates ?? 0 },
                    { label: 'Blocked', value: listingConditionOverview.data?.summary?.blocked_candidates ?? 0 },
                    { label: 'Unknown', value: listingConditionOverview.data?.summary?.unknown_candidates ?? 0 },
                    { label: 'Used/Refurb/Open-box', value: Number(listingConditionOverview.data?.summary?.used_candidates ?? 0) + Number(listingConditionOverview.data?.summary?.refurbished_candidates ?? 0) + Number(listingConditionOverview.data?.summary?.open_box_candidates ?? 0) },
                    { label: 'Mixed بلا allowlist', value: listingConditionOverview.data?.summary?.mixed_without_allowlist_count ?? 0 },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">{item.label}</div>
                      <div className="text-2xl font-bold mt-1">{Number(item.value ?? 0).toLocaleString()}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">أكثر أسباب الحجز</div>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={listingConditionReason === 'all' ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => setListingConditionReason('all')}
                    >
                      الكل
                    </Badge>
                    {(listingConditionOverview.data?.reasons ?? []).map((item) => (
                      <Badge
                        key={item.reason_key}
                        variant={listingConditionReason === item.reason_key ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setListingConditionReason(item.reason_key)}
                      >
                        {item.reason_key} • {Number(item.count ?? 0).toLocaleString()}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border">
                  <div className="border-b p-3 text-sm font-medium">أكثر المصادر التي تُحجز منها listings</div>
                  <div className="max-h-[280px] overflow-auto">
                    {(listingConditionOverview.data?.sources ?? []).length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">لا توجد بيانات condition بعد.</div>
                    ) : (
                      (listingConditionOverview.data?.sources ?? []).map((item) => (
                        <div key={`${item.source_id ?? item.source_domain}`} className="grid gap-2 border-b p-3 text-sm last:border-b-0 md:grid-cols-[minmax(0,2fr),repeat(5,minmax(0,1fr))]">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{item.source_name || item.source_domain || 'مصدر غير معروف'}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {item.source_domain} • {item.catalog_condition_policy || 'unknown'} • {item.source_kind || 'n/a'}
                            </div>
                          </div>
                          <div>total: {Number(item.total_candidates ?? 0).toLocaleString()}</div>
                          <div>blocked: {Number(item.blocked_candidates ?? 0).toLocaleString()}</div>
                          <div>unknown: {Number(item.unknown_candidates ?? 0).toLocaleString()}</div>
                          <div>mixed: {Number(item.mixed_without_allowlist_count ?? 0).toLocaleString()}</div>
                          <div>
                            <Button size="sm" variant="outline" onClick={() => {
                              setListingConditionSourceId(String(item.source_id ?? 'all'));
                              if (item.source_id) setSectionPolicySourceId(String(item.source_id));
                            }}>
                              فلترة
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Section policies للمصادر الـ mixed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>اختر المصدر</Label>
                    <Select value={sectionPolicySourceId} onValueChange={setSectionPolicySourceId}>
                      <SelectTrigger><SelectValue placeholder="اختر مصدر" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">اختر مصدر</SelectItem>
                        {(sources.data ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name_ar} • {s.domain}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>فلتر quarantine حسب المصدر</Label>
                    <Select value={listingConditionSourceId} onValueChange={setListingConditionSourceId}>
                      <SelectTrigger><SelectValue placeholder="كل المصادر" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">كل المصادر</SelectItem>
                        {(sources.data ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name_ar} • {s.domain}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {sectionPolicySourceId === 'all' ? (
                  <div className="text-sm text-muted-foreground">اختر مصدرًا حتى تضيف أو تعدّل section allowlists/blocklists.</div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Section key</Label>
                        <Input value={newSectionPolicy.section_key} onChange={(e) => setNewSectionPolicy((prev) => ({ ...prev, section_key: e.target.value }))} placeholder="new_arrivals" />
                      </div>
                      <div className="space-y-2">
                        <Label>Section label</Label>
                        <Input value={newSectionPolicy.section_label} onChange={(e) => setNewSectionPolicy((prev) => ({ ...prev, section_label: e.target.value }))} placeholder="New Arrivals" />
                      </div>
                      <div className="space-y-2">
                        <Label>Section URL</Label>
                        <Input value={newSectionPolicy.section_url} onChange={(e) => setNewSectionPolicy((prev) => ({ ...prev, section_url: e.target.value }))} placeholder="/new-arrivals" />
                      </div>
                      <div className="space-y-2">
                        <Label>Policy scope</Label>
                        <Select value={newSectionPolicy.policy_scope} onValueChange={(v) => setNewSectionPolicy((prev) => ({ ...prev, policy_scope: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="allow">allow</SelectItem>
                            <SelectItem value="block">block</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Condition policy</Label>
                        <Select value={newSectionPolicy.condition_policy} onValueChange={(v) => setNewSectionPolicy((prev) => ({ ...prev, condition_policy: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new_only">new_only</SelectItem>
                            <SelectItem value="mixed">mixed</SelectItem>
                            <SelectItem value="unknown">unknown</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Priority</Label>
                        <Input type="number" min={1} max={1000} value={newSectionPolicy.priority} onChange={(e) => setNewSectionPolicy((prev) => ({ ...prev, priority: Number(e.target.value) }))} />
                      </div>
                    </div>

                    <Button
                      disabled={saveSectionPolicy.isPending || !newSectionPolicy.section_key.trim()}
                      onClick={() => saveSectionPolicy.mutate({
                        source_id: sectionPolicySourceId,
                        section_key: newSectionPolicy.section_key.trim(),
                        section_label: newSectionPolicy.section_label.trim() || null,
                        section_url: newSectionPolicy.section_url.trim() || null,
                        policy_scope: newSectionPolicy.policy_scope as 'allow' | 'block',
                        condition_policy: newSectionPolicy.condition_policy,
                        priority: Number(newSectionPolicy.priority || 100),
                      })}
                    >
                      حفظ section policy
                    </Button>

                    <div className="rounded-lg border">
                      <div className="border-b p-3 text-sm font-medium">السياسات الحالية</div>
                      <div className="max-h-[280px] overflow-auto">
                        {(sourceSectionPolicies.data ?? []).length === 0 ? (
                          <div className="p-3 text-sm text-muted-foreground">لا توجد section policies لهذا المصدر بعد.</div>
                        ) : (
                          (sourceSectionPolicies.data ?? []).map((policy) => (
                            <div key={policy.id} className="grid gap-3 border-b p-3 text-sm last:border-b-0 md:grid-cols-[minmax(0,2fr),minmax(0,1fr),minmax(0,1fr),auto]">
                              <div className="min-w-0">
                                <div className="font-medium truncate">{policy.section_label || policy.section_key}</div>
                                <div className="text-xs text-muted-foreground truncate">{policy.section_url || policy.section_key}</div>
                              </div>
                              <div className="space-y-2">
                                <Select
                                  value={String(policy.policy_scope)}
                                  onValueChange={(v) => patchSectionPolicy.mutate({ id: policy.id, patch: { policy_scope: v } })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="allow">allow</SelectItem>
                                    <SelectItem value="block">block</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Select
                                  value={String(policy.condition_policy)}
                                  onValueChange={(v) => patchSectionPolicy.mutate({ id: policy.id, patch: { condition_policy: v } })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="new_only">new_only</SelectItem>
                                    <SelectItem value="mixed">mixed</SelectItem>
                                    <SelectItem value="unknown">unknown</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Input
                                  type="number"
                                  min={1}
                                  max={1000}
                                  defaultValue={Number(policy.priority ?? 100)}
                                  onBlur={(e) => patchSectionPolicy.mutate({ id: policy.id, patch: { priority: Number((e.target as HTMLInputElement).value || 100) } })}
                                />
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs text-muted-foreground">مفعّل</Label>
                                  <Switch
                                    checked={Boolean(policy.is_active)}
                                    onCheckedChange={(checked) => patchSectionPolicy.mutate({ id: policy.id, patch: { is_active: checked } })}
                                  />
                                </div>
                              </div>
                              <div className="flex items-start justify-end">
                                <Badge variant={policy.is_active ? 'default' : 'outline'}>
                                  {policy.is_active ? 'active' : 'inactive'}
                                </Badge>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">آخر listings المحجوزة بسبب condition gate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {listingConditionBlocked.isLoading ? (
                  <div className="text-sm text-muted-foreground">جاري تحميل العناصر المحجوزة…</div>
                ) : listingConditionBlocked.isError ? (
                  <div className="text-sm text-destructive">تعذّر تحميل عناصر condition quarantine.</div>
                ) : (listingConditionBlocked.data?.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">لا توجد عناصر محجوزة ضمن الفلاتر الحالية.</div>
                ) : (
                  <div className="space-y-3">
                    {(listingConditionBlocked.data ?? []).map((item) => (
                      <div key={item.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{item.product_name || 'منتج بدون اسم'}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {item.source_name || item.source_domain || 'مصدر غير معروف'} • {item.catalog_condition_policy || 'unknown'}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{item.listing_condition || 'unknown'}</Badge>
                            <Badge variant="destructive">{item.condition_reason || item.publish_reason || 'blocked'}</Badge>
                            {typeof item.condition_confidence === 'number' ? (
                              <Badge variant="outline">{Math.round(item.condition_confidence * 100)}%</Badge>
                            ) : null}
                          </div>
                        </div>
                        {item.section_key || item.section_url ? (
                          <div className="text-xs text-muted-foreground">
                            section: {item.section_label || item.section_key || '—'} • {item.policy_scope || '—'} • {item.section_condition_policy || '—'}
                          </div>
                        ) : null}
                        {item.source_url ? (
                          <a href={item.source_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline break-all">
                            {item.source_url}
                          </a>
                        ) : null}
                        {item.payload_excerpt ? (
                          <div className="text-xs text-muted-foreground line-clamp-3">{item.payload_excerpt}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* PLUGINS */}
          <TabsContent value="plugins" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">حزم جاهزة للمصادر (Source Packs)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  هذه حزم JSON جاهزة داخل المشروع. تنصيب الحزمة يضيف مواقع كثيرة دفعة واحدة (Merge بدون حذف الموجود).
                </div>

                {sourcePacksIndex.isLoading ? (
                  <div className="text-sm text-muted-foreground">جاري تحميل الحزم…</div>
                ) : sourcePacksIndex.isError ? (
                  <div className="text-sm text-destructive">فشل تحميل الحزم</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {(sourcePacksIndex.data?.packs ?? []).map((p) => (
                      <div key={p.id} className="rounded-md border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">
                              {p.name_ar} {p.recommended ? <span className="text-xs text-emerald-600">• مقترحة</span> : null}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{p.description_ar}</div>
                            <div className="text-xs text-muted-foreground mt-2">
                              {typeof p.count === 'number' ? `${p.count} مصدر` : '—'}{' '}
                              {Array.isArray(p.tags) && p.tags.length ? `• ${p.tags.join(' • ')}` : ''}
                            </div>
                          </div>

                          <Button
                            disabled={installPack.isPending}
                            onClick={() => installPack.mutate(p)}
                          >
                            تنصيب
                          </Button>
                        </div>

                        {packProgress.packId === p.id && packProgress.total > 0 ? (
                          <div className="mt-3 text-xs text-muted-foreground">
                            جاري التنصيب… {packProgress.done}/{packProgress.total}
                            {packProgress.errors ? ` • أخطاء: ${packProgress.errors}` : ''}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  بعد تنصيب الحزمة: روح لتبويب <b>تشغيل</b> واضغط <b>تشغيل الكل</b> حتى يبدي يجمع منتجات.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">بلجن المواقع (Export / Import / Test)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>اختيار موقع</Label>
                    <Select
                      value={pluginDomain}
                      onValueChange={(v) => {
                        setPluginDomain(v);
                        setTestResult(null);
                        setTestUrl('');
                        setPluginJson('');
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر دومين" />
                      </SelectTrigger>
                      <SelectContent>
                        {(plugins.data ?? []).map((p) => (
                          <SelectItem key={p.domain} value={p.domain}>
                            {p.domain}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <Button variant="outline" disabled={!pluginDomain || loadPlugin.isPending} onClick={() => loadPlugin.mutate(pluginDomain)}>
                      تحميل
                    </Button>
                    <Button
                      disabled={!pluginJson || importPlugin.isPending}
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(pluginJson);
                          const plugin = parsed?.plugin ?? parsed;
                          importPlugin.mutate({ plugin, mode: 'replace' });
                        } catch {
                          toast.error('JSON غير صالح');
                        }
                      }}
                    >
                      استيراد
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>JSON البلجن</Label>
                  <textarea
                    value={pluginJson}
                    onChange={(e) => setPluginJson(e.target.value)}
                    className="w-full h-[320px] rounded-md border bg-background p-3 font-mono text-xs"
                    placeholder="اضغط تحميل لجلب البلجن، أو الصق JSON هنا ثم استيراد"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>اختبار رابط</Label>
                    <Input value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder="https://example.com/product/..." />
                    <Button
                      variant="outline"
                      disabled={!testUrl || testPlugin.isPending}
                      onClick={() => testPlugin.mutate({ url: testUrl, domain: pluginDomain || undefined })}
                    >
                      اختبار
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>نتيجة الاختبار</Label>
                    <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono h-[120px] overflow-auto">
                      {testResult ? prettyJson(testResult?.extracted ?? testResult) : '—'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* JOBS */}
          <TabsContent value="jobs" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">تشغيل الـ Pipeline</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <Button className="gap-2" disabled={action.isPending} onClick={() => action.mutate('seed')}>
                  <PlayCircle className="h-4 w-4" />
                  1) Seed Crawl Frontier
                </Button>
                <Button className="gap-2" disabled={action.isPending} onClick={() => action.mutate('ingest')}>
                  <PlayCircle className="h-4 w-4" />
                  2) Ingest Product Pages
                </Button>
                <Button variant="secondary" className="gap-2" disabled={action.isPending} onClick={() => action.mutate('apis')}>
                  <PlayCircle className="h-4 w-4" />
                  3) Probe Product APIs
                </Button>
                <Button variant="secondary" className="gap-2" disabled={action.isPending} onClick={() => action.mutate('images')}>
                  <PlayCircle className="h-4 w-4" />
                  4) Verify/Recrawl Images
                </Button>
                <Button variant="outline" className="gap-2 md:col-span-2" disabled={action.isPending} onClick={() => action.mutate('refresh')}>
                  <RefreshCcw className="h-4 w-4" />
                  تشغيل الكل (Seed → APIs → Ingest → Images)
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">آخر التشغيلات</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(runs.data ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">لا توجد تشغيلات بعد.</div>
                ) : (
                  (runs.data ?? []).map((r) => (
                    <div key={`${r.run_id}-${r.function_name}`} className="border border-border rounded-md p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold">{r.function_name}</div>
                        <div className="text-xs text-muted-foreground">{r.status}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        processed {r.processed} • ok {r.succeeded} • fail {r.failed}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(r.started_at).toLocaleString('ar-IQ')}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">مراجعة الأسعار المشبوهة (Quarantine)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {(['pending','approved','rejected','ignored','all'] as const).map((status) => (
                    <Button key={status} type="button" size="sm" variant={quarantineStatusFilter === status ? 'default' : 'outline'} onClick={() => setQuarantineStatusFilter(status)}>
                      {status === 'pending' ? 'قيد المراجعة' : status === 'approved' ? 'مقبول' : status === 'rejected' ? 'مرفوض' : status === 'ignored' ? 'متجاهَل' : 'الكل'}
                    </Button>
                  ))}
                </div>

                {quarantineItems.isLoading ? (
                  <div className="text-sm text-muted-foreground">جارِ تحميل قائمة المراجعة…</div>
                ) : quarantineItems.isError ? (
                  <div className="text-sm text-destructive">تعذّر تحميل قائمة المراجعة.</div>
                ) : quarantineItems.data?.tableReady === false ? (
                  <div className="text-sm text-amber-600">جدول المراجعة غير موجود بعد. طبّق المايغريشن الجديد ثم حدّث الصفحة.</div>
                ) : (quarantineItems.data?.items?.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">ماكو عناصر ضمن الفلتر الحالي.</div>
                ) : (
                  <div className="space-y-3">
                    {quarantineItems.data?.items?.map((item) => (
                      <div key={item.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{item.product_name || 'منتج بدون اسم'}</div>
                            <div className="text-xs text-muted-foreground truncate">{item.source_name || item.source_domain || 'مصدر غير معروف'}</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={item.status === 'pending' ? 'secondary' : item.status === 'approved' ? 'default' : 'outline'}>{item.status}</Badge>
                            {typeof item.parsed_price === 'number' ? <Badge variant="outline">{Number(item.parsed_price).toLocaleString()} {item.currency || ''}</Badge> : null}
                            {item.reason_code ? <Badge variant="destructive">{item.reason_code}</Badge> : null}
                          </div>
                        </div>
                        {item.reason_detail ? <div className="text-xs text-muted-foreground">{item.reason_detail}</div> : null}
                        {item.raw_price ? <div className="text-xs"><span className="text-muted-foreground">النص الخام:</span> {item.raw_price}</div> : null}
                        {item.product_url ? <a href={item.product_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline break-all">{item.product_url}</a> : null}
                        <Input value={quarantineReviewNotes[item.id] ?? ''} onChange={(e) => setQuarantineReviewNotes((prev) => ({ ...prev, [item.id]: e.target.value }))} placeholder="ملاحظة مراجعة (اختياري)" />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => reviewQuarantine.mutate({ id: item.id, status: 'approved' })} disabled={reviewQuarantine.isPending}>اعتماد</Button>
                          <Button size="sm" variant="secondary" onClick={() => reviewQuarantine.mutate({ id: item.id, status: 'approved', restoreObservation: true })} disabled={reviewQuarantine.isPending}>اعتماد + استرجاع السعر</Button>
                          <Button size="sm" variant="destructive" onClick={() => reviewQuarantine.mutate({ id: item.id, status: 'rejected' })} disabled={reviewQuarantine.isPending}>رفض</Button>
                          <Button size="sm" variant="outline" onClick={() => reviewQuarantine.mutate({ id: item.id, status: 'ignored' })} disabled={reviewQuarantine.isPending}>تجاهل</Button>
                          <Button size="sm" variant="outline" onClick={() => reviewQuarantine.mutate({ id: item.id, status: 'pending' })} disabled={reviewQuarantine.isPending}>إرجاع</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ERRORS */}
          <TabsContent value="errors" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">آخر أخطاء الـ Ingestion</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(errors.data ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">ماكو أخطاء مسجلة.</div>
                ) : (
                  (errors.data ?? []).map((e, idx) => (
                    <div key={`${e.created_at}-${idx}`} className="border border-border rounded-md p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-sm">{e.error_code}</div>
                        <div className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString('ar-IQ')}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{e.source_domain}</div>
                      <div className="text-xs break-all mt-1">{e.url}</div>
                      {(e.http_status || e.blocked_reason) && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {e.http_status ? `HTTP ${e.http_status}` : ''}
                          {e.blocked_reason ? ` • ${e.blocked_reason}` : ''}
                        </div>
                      )}
                      {e.error_message && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.error_message}</div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* HEALTH */}
          <TabsContent value="health" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">مراقبة صحة المصادر (24 ساعة)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
<div className="flex flex-wrap gap-2">
  <Button variant="outline" className="gap-2" disabled={sourceHealth.isLoading} onClick={() => sourceHealth.refetch()}>
    تحديث
  </Button>
  <Button
    variant="outline"
    className="gap-2"
    disabled={patchSourceHealthSchema.isPending}
    onClick={() => patchSourceHealthSchema.mutate()}
    title="يضيف أعمدة backoff/budget/diagnostics للمصادر (آمن + idempotent)"
  >
    <DatabaseZap className="h-4 w-4" />
    Patch Health Schema
  </Button>
  <Button
    className="gap-2"
    disabled={runHealthScan.isPending}
    onClick={() => runHealthScan.mutate()}
    title="يفحص الفشل/النجاح ويعطل المصادر المتعبة تلقائيًا"
  >
    <Activity className="h-4 w-4" />
    تشغيل فحص الصحة + Auto Disable/Recover
  </Button>
  <Button
    variant="outline"
    className="gap-2"
    disabled={recomputeTrust.isPending}
    onClick={() => recomputeTrust.mutate()}
    title="يعيد حساب trust_weight_dynamic حسب الصحة + الشذوذ + بلاغات المستخدمين"
  >
    <Activity className="h-4 w-4" />
    تحديث Trust Graph
  </Button>
  <Button
    variant="outline"
    className="gap-2"
    disabled={dispatchPriceAlerts.isPending}
    onClick={() => dispatchPriceAlerts.mutate()}
    title="يفحص تنبيهات الأسعار ويولّد إشعارات للمستخدمين عند تحقق الهدف"
  >
    <Bell className="h-4 w-4" />
    توليد إشعارات التنبيهات
  </Button>
</div>

<div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Shadow Mode (Candidate → Validate → Activate)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>الهدف (عدد المصادر)</Label>
                          <Input type="number" value={discoverTarget} onChange={(e) => setDiscoverTarget(Number(e.target.value))} />
                        </div>
                        <div className="space-y-2">
                          <Label>ملاحظات</Label>
                          <div className="text-xs text-muted-foreground">
                            المصادر الجديدة تدخل Candidate (غير مرئية للمستخدم) وتُزحف بالخلفية فقط.
                          </div>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>فلترة حسب قطاع (CSV)</Label>
                          <Input value={discoverSectors} onChange={(e) => setDiscoverSectors(e.target.value)} placeholder="سوبرماركت,الكترونيات,صيدلية..." />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>فلترة حسب محافظة/مدينة (CSV)</Label>
                          <Input value={discoverProvinces} onChange={(e) => setDiscoverProvinces(e.target.value)} placeholder="بغداد,البصرة,..." />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Pack pilot scope</Label>
                          <Select value={pilotScopePack} onValueChange={setPilotScopePack}>
                            <SelectTrigger>
                              <SelectValue placeholder="بدون pack محددة" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">بدون pack محددة</SelectItem>
                              {(sourcePacksIndex.data?.packs ?? []).map((pack) => (
                                <SelectItem key={pack.id} value={pack.id}>
                                  {pack.name_ar}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Domains pilot scope (CSV)</Label>
                          <Input
                            value={pilotScopeDomains}
                            onChange={(e) => setPilotScopeDomains(e.target.value)}
                            placeholder="iraq.talabat.com, totersapp.com, miswag.com"
                          />
                          <div className="text-xs text-muted-foreground">
                            إذا اخترت pack وكتبت domains، النظام يجمعهم سوا ويشغل الـ pilot فقط عليهم.
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button className="gap-2" disabled={discoverSourcesJob.isPending} onClick={() => discoverSourcesJob.mutate()}>
                          <Wand2 className="h-4 w-4" />
                          اكتشاف مصادر جديدة (Candidate)
                        </Button>
                        <Button variant="outline" className="gap-2" disabled={validateCandidatesJob.isPending} onClick={() => validateCandidatesJob.mutate()}>
                          <Bug className="h-4 w-4" />
                          Validate Candidates
                        </Button>
                        <Button variant="outline" className="gap-2" disabled={activateCandidatesJob.isPending} onClick={() => activateCandidatesJob.mutate()}>
                          <PlayCircle className="h-4 w-4" />
                          Activate Passed
                        </Button>
                        <Button variant="outline" className="gap-2" disabled={certifySourcesJob.isPending} onClick={() => certifySourcesJob.mutate()}>
                          <Activity className="h-4 w-4" />
                          Certification Dry-Run
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" className="gap-2" disabled={scopedSeedPilotJob.isPending} onClick={() => scopedSeedPilotJob.mutate()}>
                          <DatabaseZap className="h-4 w-4" />
                          Seed Scoped Pilot
                        </Button>
                        <Button variant="secondary" className="gap-2" disabled={scopedIngestPilotJob.isPending} onClick={() => scopedIngestPilotJob.mutate()}>
                          <PlayCircle className="h-4 w-4" />
                          Ingest Scoped Pilot
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className="gap-2" disabled={rollupHealth.isPending} onClick={() => rollupHealth.mutate()}>
                          <Activity className="h-4 w-4" />
                          تحديث ملخص الصحة (Daily Rollup)
                        </Button>
                        <Button variant="outline" className="gap-2" disabled={fxUpdateDailyJob.isPending} onClick={() => fxUpdateDailyJob.mutate()}>
                          <RefreshCcw className="h-4 w-4" />
                          تحديث سعر الصرف اليوم
                        </Button>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        ملاحظة: الاكتشاف يعتمد على SearxNG داخل Docker (بدون مفاتيح API). إذا تريد Target 1000 غيّر الرقم وكرر.
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Source Health Dashboard (آخر ملخص)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button variant="outline" disabled={sourceHealthLatest.isLoading} onClick={() => sourceHealthLatest.refetch()}>
                          تحديث
                        </Button>
                      </div>

                      {sourceHealthLatest.isLoading ? (
                        <div className="text-sm text-muted-foreground">جارِ تحميل…</div>
                      ) : sourceHealthLatest.isError ? (
                        <div className="text-sm text-destructive">تعذّر تحميل ملخص الصحة.</div>
                      ) : (
                        <div className="max-h-[360px] overflow-auto rounded-md border">
                          {(((sourceHealthLatest.data?.sources ?? []) as any[]) ?? []).slice(0, 120).map((s) => (
                            <div key={s.source_id} className="flex items-center justify-between gap-3 border-b p-2 text-sm last:border-b-0">
                              <div className="truncate">
                                <div className="font-medium">{s.domain}</div>
                                <div className="text-xs text-muted-foreground">{s.day}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">OK {s.successes ?? 0}</Badge>
                                <Badge variant={(Number(s.error_rate ?? 0) >= 0.5) ? 'destructive' : 'outline'}>
                                  ERR {s.failures ?? 0}
                                </Badge>
                                {s.anomaly_rate != null && (
                                  <Badge variant="outline">AN {Math.round(Number(s.anomaly_rate) * 100)}%</Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Pack Certification Review</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!hasPilotScope ? (
                      <div className="text-sm text-muted-foreground">
                        اختَر pack أو domains من فوق حتى يظهر review الحقيقي للحزمة الحالية فقط.
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={packReviewVerdict.status === 'go' ? 'default' : packReviewVerdict.status === 'stop' ? 'destructive' : 'outline'}>
                            {packReviewVerdict.status === 'go' ? 'القرار: كمل' : packReviewVerdict.status === 'stop' ? 'القرار: وقف' : 'القرار: اختر scope'}
                          </Badge>
                          {selectedPilotPack ? <Badge variant="outline">{selectedPilotPack.name_ar}</Badge> : null}
                          {normalizeScopeDomains(pilotScopeDomains).length ? (
                            <Badge variant="outline">domains: {normalizeScopeDomains(pilotScopeDomains).length}</Badge>
                          ) : null}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                          {[
                            { label: 'Sources in scope', value: certificationItems.length },
                            { label: 'Published/Anchor', value: certificationItems.filter((item) => ['published', 'anchor'].includes(String(item.certification_tier ?? ''))).length },
                            { label: 'High-error sources', value: healthItems.filter((item) => Number(item.error_rate ?? 0) >= 0.2).length },
                            { label: 'Blocked listings', value: Number(listingConditionOverview.data?.summary?.blocked_candidates ?? 0) },
                            { label: 'Taxonomy quarantine', value: taxonomyItems.length },
                          ].map((item) => (
                            <div key={item.label} className="rounded-lg border p-3">
                              <div className="text-xs text-muted-foreground">{item.label}</div>
                              <div className="mt-1 text-2xl font-bold">{Number(item.value ?? 0).toLocaleString()}</div>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-lg border p-3">
                          <div className="mb-2 text-sm font-medium">أسباب القرار</div>
                          <div className="space-y-1 text-sm">
                            {packReviewVerdict.reasons.map((reason) => (
                              <div key={reason} className="text-muted-foreground">{reason}</div>
                            ))}
                          </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-3">
                          <div className="rounded-lg border">
                            <div className="border-b p-3 text-sm font-medium">Certification</div>
                            <div className="max-h-[260px] overflow-auto">
                              {scopedSourceCertification.isLoading ? (
                                <div className="p-3 text-sm text-muted-foreground">جارٍ تحميل certification…</div>
                              ) : certificationItems.length === 0 ? (
                                <div className="p-3 text-sm text-muted-foreground">ماكو certification data ضمن الـ scope الحالي.</div>
                              ) : (
                                certificationItems.map((item) => (
                                  <div key={item.id} className="border-b p-3 text-sm last:border-b-0">
                                    <div className="font-medium">{item.name_ar || item.domain}</div>
                                    <div className="text-xs text-muted-foreground">{item.domain}</div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <Badge variant="outline">{item.certification_tier || 'n/a'}</Badge>
                                      <Badge variant="outline">{item.certification_status || 'n/a'}</Badge>
                                      <Badge variant={item.catalog_publish_enabled ? 'default' : 'secondary'}>
                                        {item.catalog_publish_enabled ? 'publish on' : 'publish off'}
                                      </Badge>
                                      <Badge variant="outline">q {Number(item.quality_score ?? 0).toFixed(2)}</Badge>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="rounded-lg border">
                            <div className="border-b p-3 text-sm font-medium">Health</div>
                            <div className="max-h-[260px] overflow-auto">
                              {scopedSourceHealth.isLoading ? (
                                <div className="p-3 text-sm text-muted-foreground">جارٍ تحميل health…</div>
                              ) : healthItems.length === 0 ? (
                                <div className="p-3 text-sm text-muted-foreground">ماكو health data ضمن الـ scope الحالي.</div>
                              ) : (
                                healthItems.map((item) => (
                                  <div key={item.source_id || item.domain} className="border-b p-3 text-sm last:border-b-0">
                                    <div className="font-medium">{item.source_name || item.domain}</div>
                                    <div className="text-xs text-muted-foreground">{item.domain}</div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <Badge variant="secondary">OK {Number(item.successes ?? 0)}</Badge>
                                      <Badge variant={Number(item.error_rate ?? 0) >= 0.2 ? 'destructive' : 'outline'}>
                                        ERR {Math.round(Number(item.error_rate ?? 0) * 100)}%
                                      </Badge>
                                      <Badge variant="outline">AN {Math.round(Number(item.anomaly_rate ?? 0) * 100)}%</Badge>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="rounded-lg border">
                            <div className="border-b p-3 text-sm font-medium">Taxonomy / Condition</div>
                            <div className="max-h-[260px] overflow-auto">
                              {scopedTaxonomyQuarantine.isLoading ? (
                                <div className="p-3 text-sm text-muted-foreground">جارٍ تحميل taxonomy quarantine…</div>
                              ) : (
                                <>
                                  <div className="border-b p-3 text-sm">
                                    <div className="font-medium">Condition blocked</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      blocked: {Number(listingConditionOverview.data?.summary?.blocked_candidates ?? 0).toLocaleString()} • mixed بلا allowlist: {Number(listingConditionOverview.data?.summary?.mixed_without_allowlist_count ?? 0).toLocaleString()}
                                    </div>
                                  </div>
                                  {taxonomyItems.length === 0 ? (
                                    <div className="p-3 text-sm text-muted-foreground">ماكو taxonomy quarantine ضمن الـ scope الحالي.</div>
                                  ) : (
                                    taxonomyItems.map((item) => (
                                      <div key={item.id} className="border-b p-3 text-sm last:border-b-0">
                                        <div className="font-medium">{item.product_name || 'منتج بدون اسم'}</div>
                                        <div className="text-xs text-muted-foreground">{item.domain || item.site_category_raw || 'unknown domain'}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {item.reason || 'no reason'} {item.conflict ? '• conflict' : ''}
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>


                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Auto-Discovery (يومي) + Auto-tune</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" disabled={autoDiscoveryStatus.isLoading} onClick={() => autoDiscoveryStatus.refetch()}>
                          تحديث
                        </Button>
                        <Button variant="outline" className="gap-2" disabled={patchAppSettingsSchemaJob.isPending} onClick={() => patchAppSettingsSchemaJob.mutate()}>
                          <DatabaseZap className="h-4 w-4" />
                          Patch app_settings
                        </Button>
                        <Button className="gap-2" disabled={runAutoDiscoveryNow.isPending} onClick={() => runAutoDiscoveryNow.mutate()}>
                          <Wand2 className="h-4 w-4" />
                          Run Now (force)
                        </Button>
                      </div>

                      {autoDiscoveryStatus.isLoading ? (
                        <div className="text-sm text-muted-foreground">جارِ تحميل…</div>
                      ) : autoDiscoveryStatus.isError ? (
                        <div className="text-sm text-destructive">تعذّر تحميل حالة Auto-Discovery.</div>
                      ) : (
                        <div className="space-y-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">enabled: {String(autoDiscoveryStatus.data?.settings?.enabled ?? 'n/a')}</Badge>
                            <Badge variant="outline">add/day: {autoDiscoveryStatus.data?.settings?.addPerDay ?? '-'}</Badge>
                            <Badge variant="outline">buckets: {autoDiscoveryStatus.data?.settings?.bucketsPerRun ?? '-'}</Badge>
                            <Badge variant="outline">minScore: {autoDiscoveryStatus.data?.settings?.minScore ?? '-'}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            last run day: {autoDiscoveryStatus.data?.state?.last_run_day ?? '-'} | last reason: {autoDiscoveryStatus.data?.state?.last_autotune_reason ?? '-'}
                          </div>
                          {!!(autoDiscoveryStatus.data?.state?.last_underserved_provinces?.length) && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">أكثر المحافظات نقصاً:</span>{' '}
                              {((autoDiscoveryStatus.data?.state?.last_underserved_provinces ?? []) as any[]).slice(0, 10).join('، ')}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Coverage العراق (محافظات + قطاعات)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Button variant="outline" disabled={coverageStats.isLoading} onClick={() => coverageStats.refetch()}>
                          تحديث
                        </Button>
                      </div>

                      {coverageStats.isLoading ? (
                        <div className="text-sm text-muted-foreground">جارِ تحميل…</div>
                      ) : coverageStats.isError ? (
                        <div className="text-sm text-destructive">تعذّر تحميل Coverage.</div>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">أضعف المحافظات (أقل Active Sources)</div>
                            <div className="max-h-[240px] overflow-auto rounded-md border">
                              {(((coverageStats.data?.provinces ?? []) as any[]) ?? []).slice(0, 10).map((p: any) => (
                                <div key={p.name} className="flex items-center justify-between border-b p-2 text-sm last:border-b-0">
                                  <div className="truncate">{p.name}</div>
                                  <Badge variant="outline">{p.count ?? 0}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">أضعف القطاعات (أقل Active Sources)</div>
                            <div className="max-h-[240px] overflow-auto rounded-md border">
                              {(((coverageStats.data?.sectors ?? []) as any[]) ?? []).slice(0, 10).map((s: any) => (
                                <div key={s.name} className="flex items-center justify-between border-b p-2 text-sm last:border-b-0">
                                  <div className="truncate">{s.name}</div>
                                  <Badge variant="outline">{s.count ?? 0}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="text-xs text-muted-foreground">
                        ملاحظة: التغطية تعتمد على tags داخل discovery_tags (provinces/sectors). المصادر القديمة بدون tags تظهر ضمن "بدون محافظة/قطاع".
                      </div>
                    </CardContent>
                  </Card>
                </div>



                

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Coverage العراق + Retro-tag (محافظات/قطاعات)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          disabled={coverageStats.isLoading}
                          onClick={() => {
                            coverageStats.refetch();
                            missingProvinceTags.refetch();
                            missingSectorTags.refetch();
                          }}
                        >
                          تحديث
                        </Button>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Limit</span>
                          <Input className="h-8 w-24" type="number" value={retroTagLimit} onChange={(e) => setRetroTagLimit(Number(e.target.value) || 0)} />
                        </div>

                        <div className="flex items-center gap-2">
                          <Checkbox checked={retroTagDryRun} onCheckedChange={(v) => setRetroTagDryRun(Boolean(v))} />
                          <span className="text-xs text-muted-foreground">Dry-run</span>
                        </div>

                        <Button className="gap-2" disabled={retroTagJob.isPending} onClick={() => retroTagJob.mutate({ limit: retroTagLimit, dryRun: retroTagDryRun })}>
                          <Wand2 className="h-4 w-4" />
                          Retro-tag
                        </Button>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Days</span>
                          <Input className="h-8 w-24" type="number" value={catalogTagDays} onChange={(e) => setCatalogTagDays(Number(e.target.value) || 0)} />
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Min</span>
                          <Input className="h-8 w-24" type="number" value={catalogMinSamples} onChange={(e) => setCatalogMinSamples(Number(e.target.value) || 0)} />
                        </div>

                        <div className="flex items-center gap-2">
                          <Checkbox checked={catalogDryRun} onCheckedChange={(v) => setCatalogDryRun(Boolean(v))} />
                          <span className="text-xs text-muted-foreground">Catalog dry-run</span>
                        </div>

                        <Button
                          variant="secondary"
                          className="gap-2"
                          disabled={catalogSectorsJob.isPending}
                          onClick={() =>
                            catalogSectorsJob.mutate({
                              limit: retroTagLimit,
                              days: catalogTagDays,
                              minSamples: catalogMinSamples,
                              dryRun: catalogDryRun,
                            })
                          }
                        >
                          <Wand2 className="h-4 w-4" />
                          Catalog Sectors
                        </Button>

                      </div>

                      {coverageStats.isLoading ? (
                        <div className="text-sm text-muted-foreground">جارِ تحميل…</div>
                      ) : coverageStats.isError ? (
                        <div className="text-sm text-destructive">تعذّر تحميل Coverage.</div>
                      ) : (
                        <div className="grid gap-3">
                          <div className="rounded-md border p-2">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <Badge variant="outline">Total: {Number(coverageStats.data?.summary?.total ?? 0)}</Badge>
                              <Badge variant={Number(coverageStats.data?.summary?.missing_provinces ?? 0) > 0 ? 'secondary' : 'outline'}>
                                Missing provinces: {Number(coverageStats.data?.summary?.missing_provinces ?? 0)}
                              </Badge>
                              <Badge variant={Number(coverageStats.data?.summary?.missing_sectors ?? 0) > 0 ? 'secondary' : 'outline'}>
                                Missing sectors: {Number(coverageStats.data?.summary?.missing_sectors ?? 0)}
                              </Badge>
                            </div>

                            <div className="grid gap-2 md:grid-cols-2">
                              <div>
                                <div className="mb-1 text-xs font-semibold">أضعف محافظات</div>
                                <div className="flex flex-wrap gap-2">
                                  {(((coverageStats.data?.provinces ?? []) as any[]) ?? []).slice(0, 8).map((p: any) => (
                                    <Badge key={p.province} variant="outline">
                                      {String(p.province)}: {Number(p.sources ?? 0)}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <div className="mb-1 text-xs font-semibold">أضعف قطاعات</div>
                                <div className="flex flex-wrap gap-2">
                                  {(((coverageStats.data?.sectors ?? []) as any[]) ?? []).slice(0, 8).map((s: any) => (
                                    <Badge key={s.sector} variant="outline">
                                      {String(s.sector)}: {Number(s.sources ?? 0)}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-md border p-2">
                            <div className="mb-2 text-sm font-semibold">مصادر بدون محافظة (Top)</div>
                            {missingProvinceTags.isLoading ? (
                              <div className="text-xs text-muted-foreground">جارِ تحميل…</div>
                            ) : missingProvinceTags.isError ? (
                              <div className="text-xs text-destructive">تعذّر تحميل القائمة.</div>
                            ) : (
                              <div className="max-h-[240px] overflow-auto">
                                {((((missingProvinceTags.data?.sources ?? []) as any[]) ?? [])).slice(0, 40).map((s: any) => (
                                  <div key={s.id} className="flex items-center justify-between gap-2 border-b py-1 text-xs last:border-b-0">
                                    <div className="truncate font-medium">{s.domain}</div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7"
                                      disabled={updateSourceTags.isPending}
                                      onClick={() => {
                                        const provCsv = window.prompt("المحافظات (CSV) — مثل: بغداد,البصرة", "بغداد");
                                        if (provCsv == null) return;
                                        const secCsv = window.prompt("القطاعات (CSV) — مثل: سوبرماركت,الكترونيات", "سوبرماركت");
                                        if (secCsv == null) return;
                                        const provinces = provCsv.split(",").map((x) => x.trim()).filter(Boolean);
                                        const sectors = secCsv.split(",").map((x) => x.trim()).filter(Boolean);
                                        updateSourceTags.mutate({ id: s.id, provinces, sectors, mode: "replace" });
                                      }}
                                    >
                                      Edit
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="rounded-md border p-2">
                            <div className="mb-2 text-sm font-semibold">مصادر بدون قطاع (Top)</div>
                            {missingSectorTags.isLoading ? (
                              <div className="text-xs text-muted-foreground">جارِ تحميل…</div>
                            ) : missingSectorTags.isError ? (
                              <div className="text-xs text-destructive">تعذّر تحميل القائمة.</div>
                            ) : (
                              <div className="max-h-[240px] overflow-auto">
                                {((((missingSectorTags.data?.sources ?? []) as any[]) ?? [])).slice(0, 40).map((s: any) => (
                                  <div key={s.id} className="flex items-center justify-between gap-2 border-b py-1 text-xs last:border-b-0">
                                    <div className="truncate font-medium">{s.domain}</div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7"
                                      disabled={updateSourceTags.isPending}
                                      onClick={() => {
                                        const provCsv = window.prompt("المحافظات (CSV) — مثل: بغداد,البصرة", "بغداد");
                                        if (provCsv == null) return;
                                        const secCsv = window.prompt("القطاعات (CSV) — مثل: سوبرماركت,الكترونيات", "سوبرماركت");
                                        if (secCsv == null) return;
                                        const provinces = provCsv.split(",").map((x) => x.trim()).filter(Boolean);
                                        const sectors = secCsv.split(",").map((x) => x.trim()).filter(Boolean);
                                        updateSourceTags.mutate({ id: s.id, provinces, sectors, mode: "replace" });
                                      }}
                                    >
                                      Edit
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="rounded-md border p-2">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold">مراجعة قطاع (Catalog) — Low confidence</div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button size="sm" variant="outline" className="h-7" disabled={sectorReviewQueue.isLoading} onClick={() => { sectorReviewQueue.refetch(); autoSectorCatalogStatus.refetch(); }}>
                                  تحديث
                                </Button>
                                <Button size="sm" variant="secondary" className="h-7" disabled={runAutoSectorCatalog.isPending} onClick={() => runAutoSectorCatalog.mutate({ force: true })}>
                                  Auto-run
                                </Button>
                              </div>
                            </div>

                            <div className="mb-2 text-[11px] text-muted-foreground">
                              آخر تشغيل: {autoSectorCatalogStatus.data?.state?.ran_at ? new Date(autoSectorCatalogStatus.data.state.ran_at).toLocaleString('ar-IQ') : '—'}
                              {autoSectorCatalogStatus.data?.state?.day ? ` • day: ${String(autoSectorCatalogStatus.data.state.day)}` : ''}
                              {autoSectorCatalogStatus.data?.state?.result ? ` • tagged: ${Number(autoSectorCatalogStatus.data.state.result.tagged ?? 0)} • review: ${Number(autoSectorCatalogStatus.data.state.result.reviewQueued ?? 0)}` : ''}
                            </div>

                            {sectorReviewQueue.isLoading ? (
                              <div className="text-xs text-muted-foreground">جارِ تحميل…</div>
                            ) : sectorReviewQueue.isError ? (
                              <div className="text-xs text-destructive">تعذّر تحميل قائمة المراجعة.</div>
                            ) : (
                              <div className="max-h-[260px] overflow-auto">
                                {((((sectorReviewQueue.data?.sources ?? []) as any[]) ?? [])).slice(0, 60).map((s: any) => {
                                  const review = (s.review ?? {}) as any;
                                  const sug = Array.isArray(review?.suggested) ? review.suggested : [];
                                  const pick = String(sug?.[0]?.sector ?? '');
                                  const conf = Number(review?.confidence ?? 0);
                                  const samples = Number(review?.samples ?? 0);
                                  return (
                                    <div key={s.id} className="flex items-center justify-between gap-2 border-b py-1 text-xs last:border-b-0">
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{s.domain}</div>
                                        <div className="truncate text-muted-foreground">suggested: {pick || '—'} • conf: {conf.toFixed(2)} • samples: {samples}</div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Badge variant={conf >= 0.70 ? 'secondary' : 'outline'}>{conf.toFixed(2)}</Badge>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7"
                                          disabled={acceptSectorSuggestion.isPending || !pick}
                                          onClick={() => acceptSectorSuggestion.mutate({ id: s.id, sector: pick, mode: 'merge' })}
                                        >
                                          Apply
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                                {((((sectorReviewQueue.data?.sources ?? []) as any[]) ?? [])).length === 0 ? (
                                  <div className="text-xs text-muted-foreground">ماكو عناصر بالمراجعة حالياً.</div>
                                ) : null}
                              </div>
                            )}

                            <div className="mt-2 text-[11px] text-muted-foreground">
                              الجودة: إذا الثقة ضعيفة، ما نكتب sector تلقائياً — ينضاف هنا للمراجعة حتى ما يصير تلويث للتغطية.
                            </div>
                          </div>

                          <div className="rounded-md border p-2">
                            <div className="mb-2 text-sm font-semibold">Top failed domains</div>
                            <div className="max-h-[220px] overflow-auto">
                              {(((probeQueueStats.data?.top_failed ?? []) as any[]) ?? []).slice(0, 25).map((d: any) => (
                                <div key={d.domain} className="flex items-center justify-between gap-2 border-b py-1 text-xs last:border-b-0">
                                  <div className="truncate">
                                    <div className="font-medium">{d.domain}</div>
                                    <div className="text-muted-foreground truncate">{d.last_error_code} • {d.recommendation}</div>
                                  </div>
                                  <Badge variant="destructive">{Number(d.failed ?? 0)}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Render Queue + Budget (JS-only)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" disabled={renderQueueStats.isLoading} onClick={() => renderQueueStats.refetch()}>
                          تحديث
                        </Button>
                        <Button variant="outline" disabled={patchRenderQueueSchemaJob.isPending} onClick={() => patchRenderQueueSchemaJob.mutate()}>
                          Patch Render Queue
                        </Button>
                        <Button variant="outline" disabled={seedRenderQueueJob.isPending} onClick={() => seedRenderQueueJob.mutate()}>
                          Seed Queue
                        </Button>
                        <Button variant="outline" disabled={cleanupRenderCacheJob.isPending} onClick={() => cleanupRenderCacheJob.mutate()}>
                          Cleanup TTL
                        </Button>
                        <Button variant="outline" disabled={rebalanceRenderQueueJob.isPending} onClick={() => rebalanceRenderQueueJob.mutate()}>
                          Rebalance priorities
                        </Button>
                        <div className="text-xs text-muted-foreground">
                          للمواقع الثقيلة: الـ API يسوي enqueue، والـ Worker يرندر بـ Playwright ويخزن HTML بذاكرة (TTL).
                        </div>
                      </div>

                      {renderQueueStats.isLoading ? (
                        <div className="text-sm text-muted-foreground">جارِ تحميل…</div>
                      ) : renderQueueStats.isError ? (
                        <div className="text-sm text-destructive">تعذّر تحميل إحصائيات Render Queue.</div>
                      ) : (
                        <div className="grid gap-3">
                          <div className="rounded-md border p-2">
                            <div className="mb-2 text-sm font-semibold">By status (24h)</div>
                            <div className="flex flex-wrap gap-2">
                              {(((renderQueueStats.data?.by_status ?? []) as any[]) ?? []).map((c: any, i: number) => (
                                <Badge key={i} variant={String(c.status).startsWith('failed') ? 'destructive' : String(c.status) === 'pending' ? 'secondary' : 'outline'}>
                                  {String(c.status)}: {Number(c.count ?? 0)}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-md border p-2">
                            <div className="mb-2 text-sm font-semibold">Top JS-only offenders</div>
                            <div className="max-h-[220px] overflow-auto space-y-2">
                              {(((renderQueueStats.data?.top_offenders ?? []) as any[]) ?? []).slice(0, 12).map((d: any, i: number) => (
                                <div key={`${d.domain}-${i}`} className="rounded border p-2 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="font-medium truncate">{d.domain}</div>
                                      <div className="text-muted-foreground truncate">{d.last_error_code || '—'} • {d.recommendation}</div>
                                    </div>
                                    <Badge variant="destructive">{Number(d.failed ?? 0)}</Badge>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                    <span>ok: {Number(d.succeeded ?? 0)}</span>
                                    <span>fails in row: {Number(d.render_consecutive_failures ?? 0)}</span>
                                    <span>TTL: {Number(d.render_cache_ttl_min ?? 720)}m</span>
                                    <span>stale: {Number(d.render_stale_serve_min ?? 1440)}m</span>
                                    <span>budget: {Number(d.render_budget_per_hour ?? 80)}/h</span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7"
                                      disabled={resetRenderHealthJob.isPending}
                                      onClick={() => resetRenderHealthJob.mutate(String(d.domain))}
                                    >
                                      Reset health
                                    </Button>
                                  </div>
                                </div>
                              ))}
                              {((((renderQueueStats.data?.top_offenders ?? []) as any[]) ?? []).length === 0) ? (
                                <div className="text-xs text-muted-foreground p-2">ماكو offenders حالياً.</div>
                              ) : null}
                            </div>
                          </div>

                          <div className="rounded-md border p-2">
                            <div className="mb-2 text-sm font-semibold">JS-only domain controls (budget + TTL + stale)</div>
                            <div className="mb-2">
                              <Input className="h-8" placeholder="بحث (domain)" value={jsOnlyBudgetQuery} onChange={(e) => setJsOnlyBudgetQuery(e.target.value)} />
                            </div>
                            <div className="max-h-[320px] overflow-auto">
                              {(((sources.data ?? []) as any[]) ?? [])
                                .filter((s: any) => Boolean(s.js_only))
                                .filter((s: any) => {
                                  const q = (jsOnlyBudgetQuery || '').trim().toLowerCase();
                                  if (!q) return true;
                                  return String(s.domain || '').toLowerCase().includes(q);
                                })
                                .slice(0, 80)
                                .map((s: any) => {
                                const currentBudget = Number(s.render_budget_per_hour ?? 80);
                                const currentTtl = Number(s.render_cache_ttl_min ?? 720);
                                const currentStale = Number(s.render_stale_serve_min ?? 1440);
                                const budgetVal = (renderBudgetEdits[s.id] ?? currentBudget) as number;
                                const ttlVal = (renderTtlEdits[s.id] ?? currentTtl) as number;
                                const staleVal = (renderStaleEdits[s.id] ?? currentStale) as number;
                                return (
                                  <div key={s.id} className="border-b py-2 text-xs last:border-b-0">
                                    <div className="mb-2 flex items-center gap-2">
                                      <div className="min-w-0 flex-1">
                                        <div className="font-medium truncate">{s.domain}</div>
                                        <div className="text-muted-foreground truncate">hits: {Number(s.js_only_hits ?? 0)} • last: {s.last_js_shell_at ? new Date(s.last_js_shell_at).toLocaleString('ar-IQ') : '—'}</div>
                                      </div>
                                      {s.render_paused_until ? <Badge variant="secondary">paused</Badge> : null}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Input className="h-7 w-[84px]" type="number" value={budgetVal} onChange={(e) => setRenderBudgetEdits((p) => ({ ...p, [s.id]: Number(e.target.value) }))} />
                                      <Input className="h-7 w-[84px]" type="number" value={ttlVal} onChange={(e) => setRenderTtlEdits((p) => ({ ...p, [s.id]: Number(e.target.value) }))} />
                                      <Input className="h-7 w-[84px]" type="number" value={staleVal} onChange={(e) => setRenderStaleEdits((p) => ({ ...p, [s.id]: Number(e.target.value) }))} />
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7"
                                        disabled={updateSource.isPending}
                                        onClick={() => updateSource.mutate({ id: s.id, patch: { render_budget_per_hour: budgetVal, render_cache_ttl_min: ttlVal, render_stale_serve_min: staleVal } })}
                                      >
                                        حفظ
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7" disabled={updateSource.isPending} onClick={() => updateSource.mutate({ id: s.id, patch: { render_paused_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() } })}>
                                        إيقاف 1س
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7" disabled={updateSource.isPending} onClick={() => updateSource.mutate({ id: s.id, patch: { render_paused_until: null } })}>
                                        تشغيل
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-red-600" disabled={updateSource.isPending} onClick={() => updateSource.mutate({ id: s.id, patch: { js_only: false, js_only_reason: null, js_only_hits: 0, last_js_shell_at: null, render_paused_until: null } })}>
                                        مسح JS-only
                                      </Button>
                                    </div>
                                    <div className="mt-1 text-[11px] text-muted-foreground">budget/h • ttl(min) • stale(min بعد الانتهاء)</div>
                                  </div>
                                );
                              })}
                              {(((sources.data ?? []) as any[]) ?? []).filter((s: any) => Boolean(s.js_only)).length === 0 ? (
                                <div className="text-xs text-muted-foreground p-2">ماكو دومينات JS-only بعد.</div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {sourceHealth.isLoading ? (
                  <div className="text-sm text-muted-foreground">جارِ تحميل…</div>
                ) : sourceHealth.isError ? (
                  <div className="text-sm text-destructive">تعذّر تحميل تقرير الصحة.</div>
                ) : (
                  <div className="space-y-2">
                    {((sourceHealth.data?.sources ?? []) as any[]).slice(0, 200).map((s) => (
                      <div key={s.domain} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold">{s.name_ar || s.domain}</div>
                            <div className="text-xs text-muted-foreground">{s.domain}</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {Boolean(s.auto_disabled) ? (
                              <Badge variant="destructive" title={String(s.auto_disabled_reason ?? '')}>
                                Auto-Disabled
                              </Badge>
                            ) : (
                              <Badge variant="outline">OK</Badge>
                            )}
                            {s.trust_effective != null ? (
                              <Badge variant="outline" title={s.trust_weight_dynamic != null ? `base=${Number(s.trust_weight ?? 0.5).toFixed(2)} dynamic=${Number(s.trust_weight_dynamic).toFixed(2)}` : ''}>
                                ثقة: {Number(s.trust_effective).toFixed(2)}
                              </Badge>
                            ) : null}
                            <Badge variant="secondary">نجاح: {Number(s.successes ?? 0)}</Badge>
                            <Badge variant="secondary">فشل: {Number(s.failures ?? 0)}</Badge>
                            {s.error_rate != null ? <Badge variant="outline">rate: {Number(s.error_rate).toFixed(2)}</Badge> : null}
                            {s.disabled_until ? (
                              <Badge variant="outline" title={String(s.auto_disabled_reason ?? '')}>
                                until: {new Date(s.disabled_until).toLocaleString('ar-IQ')}
                              </Badge>
                            ) : null}
                            {s.paused_until ? (
                              <Badge
                                variant="secondary"
                                title={`budget ${Number(s.budget_used ?? 0)}/${Number(s.budget_per_hour ?? 0)} • until ${new Date(s.paused_until).toLocaleString('ar-IQ')}`}
                              >
                                Paused
                              </Badge>
                            ) : null}
                            {s.last_error_code ? <Badge variant="outline">last: {String(s.last_error_code)}</Badge> : null}
                            {Boolean(s.auto_disabled) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={overrideSourceHealth.isPending}
                                onClick={() => overrideSourceHealth.mutate({ domain: s.domain, action: 'enable' })}
                                title="إلغاء التعطيل فوراً"
                              >
                                تفعيل
                              </Button>
                            ) : null}

                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-2">
                          آخر نجاح: {s.last_success_at ? new Date(s.last_success_at).toLocaleString('ar-IQ') : '—'}
                          {' • '}
                          آخر فشل: {s.last_error_at ? new Date(s.last_error_at).toLocaleString('ar-IQ') : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SMART IMPORT */}
          <TabsContent value="smart" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">استيراد أي رابط (Smart Import URL)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  الصق أي URL (منتج أو كاتيجوري). النظام يحدد الدومين، ينشئ المصدر إذا مفقود، ويضيفه للـ entrypoints أو crawl_frontier.
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <Input value={smartUrl} onChange={(e) => setSmartUrl(e.target.value)} placeholder="https://miswag.com/ar/product/..." />
                  <Button disabled={smartImport.isPending || !smartUrl.trim()} onClick={() => smartImport.mutate()}>
                    استيراد
                  </Button>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono overflow-auto">
                  {smartResult ? prettyJson(smartResult) : '—'}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* CATEGORIES */}
          <TabsContent value="categories" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">تصنيفات قوية + Overrides (Zero% لخبطه)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={patchTaxonomySchemaJob.isPending} onClick={() => patchTaxonomySchemaJob.mutate()}>
                    تطبيق Patch التصنيفات
                  </Button>
                  <Button variant="outline" disabled={backfillGrocerySubcatsJob.isPending} onClick={() => backfillGrocerySubcatsJob.mutate()}>
                    Backfill تصنيف غذائيات (Subcategories)
                  </Button>
                  <Button variant="outline" disabled={applyOverridesJob.isPending} onClick={() => applyOverridesJob.mutate()}>
                    تطبيق Overrides على المنتجات الحالية
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  ملاحظة: Overrides تُطبَّق قبل أي inference، وتقدر تقفل (Lock) الكاتيجوري/التصنيف الفرعي حتى يصير 0% لخبطه.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">إضافة Override جديد</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>نوع المطابقة</Label>
                  <Select value={String(newOverride.match_kind)} onValueChange={(v) => setNewOverride((p: any) => ({ ...p, match_kind: v }))}>
                    <SelectTrigger><SelectValue placeholder="pattern" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pattern">Pattern (Regex/كلمات)</SelectItem>
                      <SelectItem value="domain">Domain</SelectItem>
                      <SelectItem value="source_id">Source ID</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>قيمة المطابقة</Label>
                  <Input value={String(newOverride.match_value ?? '')} onChange={(e) => setNewOverride((p: any) => ({ ...p, match_value: e.target.value }))} placeholder="مثال: (iphone|ايفون) أو miswag.com" />
                </div>

                <div className="space-y-2">
                  <Label>Category</Label>
                  <Input value={String(newOverride.category ?? '')} onChange={(e) => setNewOverride((p: any) => ({ ...p, category: e.target.value }))} placeholder="groceries / electronics / beauty ..." />
                </div>

                <div className="space-y-2">
                  <Label>Subcategory (اختياري للغذائيات)</Label>
                  <Input value={String(newOverride.subcategory ?? '')} onChange={(e) => setNewOverride((p: any) => ({ ...p, subcategory: e.target.value || null }))} placeholder="grains / dairy / meat ..." />
                </div>

                <div className="space-y-2">
                  <Label>Priority (أقل = أقوى)</Label>
                  <Input type="number" value={Number(newOverride.priority ?? 100)} onChange={(e) => setNewOverride((p: any) => ({ ...p, priority: Number(e.target.value) }))} />
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={Boolean(newOverride.lock_category)} onCheckedChange={(v) => setNewOverride((p: any) => ({ ...p, lock_category: v }))} />
                  <span className="text-sm">Lock Category</span>
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={Boolean(newOverride.lock_subcategory)} onCheckedChange={(v) => setNewOverride((p: any) => ({ ...p, lock_subcategory: v }))} />
                  <span className="text-sm">Lock Subcategory</span>
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={Boolean(newOverride.is_active)} onCheckedChange={(v) => setNewOverride((p: any) => ({ ...p, is_active: v }))} />
                  <span className="text-sm">فعال</span>
                </div>

                <div className="md:col-span-2 flex justify-end">
                  <Button
                    disabled={addOverride.isPending || !String(newOverride.match_value || '').trim() || !String(newOverride.category || '').trim()}
                    onClick={() => addOverride.mutate({
                      match_kind: newOverride.match_kind,
                      match_value: String(newOverride.match_value).trim(),
                      category: String(newOverride.category).trim(),
                      subcategory: newOverride.subcategory ? String(newOverride.subcategory).trim() : null,
                      priority: Number(newOverride.priority ?? 100),
                      lock_category: Boolean(newOverride.lock_category),
                      lock_subcategory: Boolean(newOverride.lock_subcategory),
                      is_active: Boolean(newOverride.is_active),
                      note: String(newOverride.note || '').trim() || null,
                    })}
                  >
                    إضافة
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overrides الحالية</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button variant="outline" disabled={categoryOverrides.isLoading} onClick={() => categoryOverrides.refetch()}>
                    تحديث
                  </Button>
                </div>

                {categoryOverrides.isLoading ? (
                  <div className="text-sm text-muted-foreground">جارِ التحميل…</div>
                ) : categoryOverrides.isError ? (
                  <div className="text-sm text-destructive">تعذّر تحميل Overrides.</div>
                ) : (
                  <div className="max-h-[420px] overflow-auto rounded-md border">
                    {((categoryOverrides.data ?? []) as any[]).map((o) => (
                      <div key={o.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b p-3 text-sm last:border-b-0">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            <span className="text-muted-foreground">[{o.match_kind}]</span> {o.match_value}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            → {o.category}{o.subcategory ? ` / ${o.subcategory}` : ''} • priority {o.priority}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Switch
                            checked={Boolean(o.is_active)}
                            onCheckedChange={(v) => updateOverride.mutate({ id: o.id, patch: { is_active: v } })}
                          />
                          <Button variant="outline" size="sm" onClick={() => deleteOverride.mutate(o.id)} disabled={deleteOverride.isPending}>
                            حذف
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>


            <Card>
              <CardHeader>
                <CardTitle className="text-base">Taxonomy v2 (Review + تعلم) — أسرع طريقة لضبط الكاتيجوريز</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" disabled={patchTaxonomyV2SchemaJob.isPending} onClick={() => patchTaxonomyV2SchemaJob.mutate()}>
                    Patch Taxonomy v2
                  </Button>
                  <Button variant="outline" disabled={seedTaxonomyV2Job.isPending} onClick={() => seedTaxonomyV2Job.mutate()}>
                    Seed Iraqi Taxonomy
                  </Button>
                  <Button variant="outline" disabled={backfillTaxonomyV2Job.isPending} onClick={() => backfillTaxonomyV2Job.mutate()}>
                    Backfill + توليد Quarantine
                  </Button>
                  <Button variant="secondary" disabled={taxonomyV2Nodes.isLoading || taxonomyV2Quarantine.isLoading} onClick={() => { taxonomyV2Nodes.refetch(); taxonomyV2Quarantine.refetch(); }}>
                    تحديث
                  </Button>
                  <div className="flex items-center gap-2 mr-auto">
                    <Switch checked={taxApplyMappingDefault} onCheckedChange={(v) => setTaxApplyMappingDefault(Boolean(v))} />
                    <span className="text-sm">تعلّم Mapping تلقائي عند الاعتماد</span>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Taxonomy Nodes */}
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">اختيار Taxonomy Node</div>
                    <Input value={taxNodeSearch} onChange={(e) => setTaxNodeSearch(e.target.value)} placeholder="ابحث بالعربي/الانكليزي: زيت محرك / rice / iphone ..." />
                    {taxNodeMatches.length ? (
                      <div className="rounded-md border p-2 space-y-1">
                        <div className="text-xs text-muted-foreground">نتائج البحث</div>
                        {taxNodeMatches.map((n: any) => (
                          <div key={n.key} className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm truncate">{n.label_ar || n.label_en || n.key}</div>
                              <div className="text-[11px] text-muted-foreground truncate">{n.key}</div>
                            </div>
                            <Button size="sm" variant={taxSelectedKey === n.key ? 'default' : 'secondary'} onClick={() => setTaxSelectedKey(n.key)}>اختيار</Button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="rounded-md border max-h-[420px] overflow-auto p-2">
                      {taxonomyV2Nodes.isLoading ? (
                        <div className="text-sm text-muted-foreground">جارِ تحميل الشجرة…</div>
                      ) : taxonomyV2Nodes.data?.table_ready === false ? (
                        <div className="text-sm text-amber-600">جدول Taxonomy v2 غير موجود بعد. طبّق Patch ثم جرّب.</div>
                      ) : (taxTreeRoots.length === 0) ? (
                        <div className="text-sm text-muted-foreground">ماكو Nodes بعد — اضغط Seed.</div>
                      ) : (
                        <div className="space-y-1">
                          {taxTreeRoots.map((n: any) => renderTaxNode(n, 0))}
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-muted-foreground">
                      المختار: <span className="font-mono">{taxSelectedKey || '—'}</span>
                    </div>
                  </div>

                  {/* Quarantine Review */}
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Quarantine (تصحيحات التصنيف)</div>

                    <div className="flex flex-wrap gap-2">
                      {(['pending','approved','rejected','all'] as const).map((st) => (
                        <Button key={st} type="button" size="sm" variant={taxV2Status === st ? 'default' : 'outline'} onClick={() => setTaxV2Status(st)}>
                          {st === 'pending' ? 'قيد المراجعة' : st === 'approved' ? 'مقبول' : st === 'rejected' ? 'مرفوض' : 'الكل'}
                        </Button>
                      ))}
                    </div>

                    <Input value={taxV2Search} onChange={(e) => setTaxV2Search(e.target.value)} placeholder="بحث: اسم/دومين/رابط/التصنيف المقترح…" />

                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox checked={taxAllVisibleSelected} onCheckedChange={(v) => toggleSelectAllVisible(Boolean(v))} />
                      <span className="text-sm">تحديد الكل (المعروض)</span>
                      <Badge variant="secondary">مختار: {taxSelectedCount}</Badge>
                      <Button size="sm" variant="outline" disabled={taxBulkBusy} onClick={() => setTaxSelectedIds({})}>تفريغ</Button>
                      <Button size="sm" disabled={taxBulkBusy} onClick={() => bulkReviewTaxonomy('approve_inferred')}>Bulk اعتماد (المقترح)</Button>
                      <Button size="sm" variant="secondary" disabled={taxBulkBusy || !taxSelectedKey} onClick={() => bulkReviewTaxonomy('approve_selected')}>Bulk اعتماد (المختار)</Button>
                      <Button size="sm" variant="destructive" disabled={taxBulkBusy} onClick={() => bulkReviewTaxonomy('reject')}>Bulk رفض</Button>
                    </div>

                    {taxonomyV2Quarantine.isLoading ? (
                      <div className="text-sm text-muted-foreground">جارِ تحميل Quarantine…</div>
                    ) : taxonomyV2Quarantine.data?.table_ready === false ? (
                      <div className="text-sm text-amber-600">جدول Quarantine غير موجود بعد. طبّق Patch Taxonomy v2 ثم جرّب.</div>
                    ) : (taxFilteredQuarantine.length === 0) ? (
                      <div className="text-sm text-muted-foreground">ماكو عناصر ضمن الفلتر الحالي.</div>
                    ) : (
                      <div className="space-y-3 max-h-[520px] overflow-auto pr-1">
                        {taxFilteredQuarantine.map((it) => (
                          <div key={it.id} className="rounded-lg border p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2 min-w-0">
                                <Checkbox
                                  checked={Boolean(taxSelectedIds[it.id])}
                                  onCheckedChange={(v) => setTaxSelectedIds((p) => ({ ...p, [it.id]: Boolean(v) }))}
                                />
                                <div className="min-w-0">
                                  <div className="font-medium truncate">{it.product_name || 'منتج بدون اسم'}</div>
                                  <div className="text-xs text-muted-foreground truncate">{it.domain || '—'} {it.site_category_raw ? `• ${it.site_category_raw}` : ''}</div>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={it.status === 'pending' ? 'secondary' : it.status === 'approved' ? 'default' : 'outline'}>{it.status}</Badge>
                                {typeof it.confidence === 'number' ? <Badge variant="outline">{Number(it.confidence).toFixed(2)}</Badge> : null}
                                {it.conflict ? <Badge variant="destructive" title={String(it.conflict_reason ?? '')}>Conflict</Badge> : null}
                              </div>
                            </div>

                            <div className="text-xs">
                              <span className="text-muted-foreground">مقترح:</span>{' '}
                              <span className="font-mono">{it.inferred_taxonomy_key || '—'}</span>
                              {it.chosen_taxonomy_key ? (
                                <>
                                  {'  '}<span className="text-muted-foreground">• مختار:</span>{' '}
                                  <span className="font-mono">{it.chosen_taxonomy_key}</span>
                                </>
                              ) : null}
                            </div>
                            {it.reason ? <div className="text-xs text-muted-foreground">{it.reason}</div> : null}
                            {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="text-xs text-primary underline break-all">{it.url}</a> : null}

                            <Input value={taxNotes[it.id] ?? ''} onChange={(e) => setTaxNotes((p) => ({ ...p, [it.id]: e.target.value }))} placeholder="ملاحظة (اختياري)" />

                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                disabled={reviewTaxonomyV2.isPending || !it.inferred_taxonomy_key}
                                onClick={() => reviewTaxonomyV2.mutate({ id: it.id, status: 'approved', taxonomy_key: it.inferred_taxonomy_key ?? null, apply_mapping: taxApplyMappingDefault, note: (taxNotes[it.id] ?? '').trim() || null })}
                              >
                                اعتماد (المقترح)
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={reviewTaxonomyV2.isPending || !taxSelectedKey}
                                onClick={() => reviewTaxonomyV2.mutate({ id: it.id, status: 'approved', taxonomy_key: taxSelectedKey, apply_mapping: taxApplyMappingDefault, note: (taxNotes[it.id] ?? '').trim() || null })}
                              >
                                اعتماد (المختار)
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={reviewTaxonomyV2.isPending}
                                onClick={() => reviewTaxonomyV2.mutate({ id: it.id, status: 'rejected', note: (taxNotes[it.id] ?? '').trim() || null })}
                              >
                                رفض
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={reviewTaxonomyV2.isPending}
                                onClick={() => reviewTaxonomyV2.mutate({ id: it.id, status: 'pending', note: (taxNotes[it.id] ?? '').trim() || null })}
                              >
                                إرجاع
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>


                <div className="space-y-3 rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">Category Conflict Review</div>
                      <div className="text-xs text-muted-foreground">حالات التعارض بين دلائل المصدر ودلائل النص — تنمنع من تلويث العرض لحد ما تنحسم.</div>
                    </div>
                    <Badge variant="secondary">{Number(categoryConflicts.data?.total ?? categoryConflicts.data?.items?.length ?? 0)} عنصر</Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(['open','resolved','ignored','all'] as const).map((st) => (
                      <Button key={st} type="button" size="sm" variant={categoryConflictStatus === st ? 'default' : 'outline'} onClick={() => setCategoryConflictStatus(st)}>
                        {st === 'open' ? 'مفتوح' : st === 'resolved' ? 'محسوم' : st === 'ignored' ? 'متجاهَل' : 'الكل'}
                      </Button>
                    ))}
                    <Button type="button" size="sm" variant="outline" onClick={() => categoryConflicts.refetch()} disabled={categoryConflicts.isFetching}>تحديث</Button>
                  </div>

                  <Input value={categoryConflictSearch} onChange={(e) => setCategoryConflictSearch(e.target.value)} placeholder="بحث: اسم المنتج / التصنيف الحالي / evidence…" />

                  {categoryConflicts.isLoading ? (
                    <div className="text-sm text-muted-foreground">جارِ تحميل التعارضات…</div>
                  ) : categoryConflicts.isError ? (
                    <div className="text-sm text-destructive">تعذّر تحميل تعارضات التصنيف.</div>
                  ) : ((categoryConflicts.data?.items ?? []) as CategoryConflictItem[]).length === 0 ? (
                    <div className="text-sm text-muted-foreground">ماكو عناصر ضمن الفلتر الحالي.</div>
                  ) : (
                    <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                      {((categoryConflicts.data?.items ?? []) as CategoryConflictItem[]).map((it) => {
                        const title = it.product_name_ar || it.product_name_en || String(it.evidence?.name ?? 'منتج بدون اسم');
                        const decided = categoryConflictDecisions[it.id] ?? it.decided_category ?? it.suggested_category ?? '';
                        const note = categoryConflictNotes[it.id] ?? it.review_note ?? '';
                        return (
                          <div key={it.id} className="rounded-lg border p-3 space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-medium truncate">{title}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  الحالي: {it.current_category || '—'} • المقترح: {it.suggested_category || '—'}
                                  {it.site_category_raw ? ` • ${it.site_category_raw}` : ''}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={it.status === 'open' ? 'destructive' : it.status === 'resolved' ? 'default' : 'outline'}>{it.status}</Badge>
                                {typeof it.signal_text_score === 'number' ? <Badge variant="outline">text {it.signal_text_score}</Badge> : null}
                                {it.signal_site ? <Badge variant="outline">site {it.signal_site}</Badge> : null}
                                {it.signal_domain ? <Badge variant="outline">domain {it.signal_domain}</Badge> : null}
                              </div>
                            </div>

                            <Input value={decided} onChange={(e) => setCategoryConflictDecisions((p) => ({ ...p, [it.id]: e.target.value }))} placeholder="الفئة النهائية (اختياري)" />
                            <Input value={note} onChange={(e) => setCategoryConflictNotes((p) => ({ ...p, [it.id]: e.target.value }))} placeholder="ملاحظة المراجع (اختياري)" />

                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                disabled={reviewCategoryConflict.isPending}
                                onClick={() => reviewCategoryConflict.mutate({ id: it.id, status: 'resolved', decided_category: decided.trim() || null, note: note.trim() || null, apply_to_product: true })}
                              >
                                اعتماد + تطبيق
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={reviewCategoryConflict.isPending}
                                onClick={() => reviewCategoryConflict.mutate({ id: it.id, status: 'resolved', decided_category: decided.trim() || null, note: note.trim() || null, apply_to_product: false })}
                              >
                                Resolve فقط
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={reviewCategoryConflict.isPending}
                                onClick={() => reviewCategoryConflict.mutate({ id: it.id, status: 'ignored', decided_category: decided.trim() || null, note: note.trim() || null, apply_to_product: false })}
                              >
                                Ignore
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={reviewCategoryConflict.isPending}
                                onClick={() => reviewCategoryConflict.mutate({ id: it.id, status: 'open', decided_category: decided.trim() || null, note: note.trim() || null, apply_to_product: false })}
                              >
                                Re-open
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  ملاحظة: إذا اعتمدت عنصر مع تفعيل "تعلم Mapping"، راح يصير الدومين يتذكر تصنيف الـ Breadcrumb/القسم وما يعيد نفس الغلطة.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* CROWD */}
          <TabsContent value="crowd" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">بلاغات المستخدمين (Crowd Signals)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={offerReports.isLoading} onClick={() => offerReports.refetch()}>
                    تحديث
                  </Button>
                  <Button className="gap-2" disabled={applyOfferReports.isPending} onClick={() => applyOfferReports.mutate()}>
                    تطبيق البلاغات على العروض (Penalties)
                  </Button>
                </div>

                {offerReports.isLoading ? (
                  <div className="text-sm text-muted-foreground">جارِ التحميل…</div>
                ) : offerReports.isError ? (
                  <div className="text-sm text-destructive">تعذّر تحميل البلاغات.</div>
                ) : ((offerReports.data?.items ?? []) as any[]).length === 0 ? (
                  <div className="text-sm text-muted-foreground">لا توجد بلاغات بعد.</div>
                ) : (
                  <div className="space-y-2">
                    {((offerReports.data?.items ?? []) as any[]).map((it, idx) => (
                      <div key={`${it.created_at}-${idx}`} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{it.product_name_ar || 'منتج'}</div>
                            <div className="text-xs text-muted-foreground truncate">{it.source_domain} • {it.report_type}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{Number(it.severity ?? 2)}/5</Badge>
                            <Badge variant="secondary">{Number(it.final_price ?? it.base_price ?? 0).toLocaleString()} د.ع</Badge>
                          </div>
                        </div>
                        {it.note ? <div className="text-xs text-muted-foreground mt-2">{it.note}</div> : null}
                        {it.source_url ? (
                          <a className="text-xs text-primary underline break-all mt-2 inline-block" href={it.source_url} target="_blank" rel="noreferrer">
                            {it.source_url}
                          </a>
                        ) : null}
                        <div className="text-xs text-muted-foreground mt-2">
                          {it.created_at ? new Date(it.created_at).toLocaleString('ar-IQ') : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>
    </RTLLayout>
  );
}
