import { describe, expect, it } from 'vitest';
import { normalizeSourceSeedRow } from './sourceSeedImport';

describe('sourceSeedImport', () => {
  it('normalizes governed source seed rows safely', () => {
    const { normalized, issues } = normalizeSourceSeedRow({
      name_ar: 'متجر بغداد',
      domain: 'https://www.baghdad-store.iq/',
      source_kind: 'marketplace',
      source_channel: 'marketplace',
      adapter_strategy: 'api',
      condition_policy: 'mixed',
      trust_weight: 0.74,
      sectors: ['Electronics', 'electronics', 'هواتف'],
      provinces: ['Baghdad', 'baghdad'],
      section_allowlists: [
        { section_url: '/new-arrivals', section_label: 'New Arrivals', condition_policy: 'new_only' },
      ],
    });

    expect(issues).toEqual([]);
    expect(normalized).not.toBeNull();
    expect(normalized?.domain).toBe('baghdad-store.iq');
    expect(normalized?.baseUrl).toBe('https://baghdad-store.iq');
    expect(normalized?.adapterStrategy).toBe('structured_api');
    expect(normalized?.catalogConditionPolicy).toBe('mixed');
    expect(normalized?.sectors).toEqual(['electronics', 'هواتف']);
    expect(normalized?.provinces).toEqual(['baghdad']);
    expect(normalized?.sectionAllowlists[0]?.sectionKey).toContain('/new-arrivals');
  });

  it('rejects used-only source seeds', () => {
    const { normalized, issues } = normalizeSourceSeedRow({
      domain: 'used-market.iq',
      condition_policy: 'used_only',
    });

    expect(normalized).toBeNull();
    expect(issues).toContain('used_only_sources_are_not_allowed');
  });
});
