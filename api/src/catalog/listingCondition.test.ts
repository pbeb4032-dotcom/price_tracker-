import { describe, expect, it } from 'vitest';
import { assessListingCondition } from './listingCondition';

describe('listingCondition', () => {
  it('blocks explicit used listings even on retailer sources', () => {
    const decision = assessListingCondition({
      source: {
        sourceId: 's1',
        domain: 'retailer.iq',
        sourceKind: 'retailer',
        sourceChannel: 'website',
        catalogConditionPolicy: 'new_only',
        conditionConfidence: 0.95,
      },
      sourceUrl: 'https://retailer.iq/p/item-1',
      productName: 'iPhone 13 used',
      description: 'excellent condition second hand',
    });

    expect(decision.publishable).toBe(false);
    expect(decision.normalizedCondition).toBe('used');
    expect(decision.reason).toBe('listing_condition_used');
  });

  it('blocks mixed marketplace listings without section allowlists', () => {
    const decision = assessListingCondition({
      source: {
        sourceId: 's2',
        domain: 'market.iq',
        sourceKind: 'marketplace',
        sourceChannel: 'marketplace',
        catalogConditionPolicy: 'mixed',
        conditionConfidence: 0.8,
      },
      sourceUrl: 'https://market.iq/electronics/iphone-15',
      productName: 'iPhone 15 Pro Max',
      description: 'latest model',
    });

    expect(decision.publishable).toBe(false);
    expect(decision.normalizedCondition).toBe('unknown');
    expect(decision.reason).toBe('mixed_source_requires_section_allowlist');
  });

  it('allows mixed sources only through explicit new-only section policies', () => {
    const decision = assessListingCondition({
      source: {
        sourceId: 's3',
        domain: 'mixed.iq',
        sourceKind: 'marketplace',
        sourceChannel: 'marketplace',
        catalogConditionPolicy: 'mixed',
        conditionConfidence: 0.8,
      },
      sectionPolicies: [
        {
          id: 'policy-1',
          sectionKey: 'new-arrivals',
          sectionUrl: '/new-arrivals',
          policyScope: 'allow',
          conditionPolicy: 'new_only',
          priority: 10,
          isActive: true,
        },
      ],
      sourceUrl: 'https://mixed.iq/new-arrivals/galaxy-s24',
      productName: 'Galaxy S24 Ultra',
      description: 'sealed box',
    });

    expect(decision.publishable).toBe(true);
    expect(decision.normalizedCondition).toBe('new');
    expect(decision.reason).toBe('section_allowlist_new_only');
    expect(decision.matchedSectionPolicyId).toBe('policy-1');
  });

  it('allows retailer sources by default when no negative signals exist', () => {
    const decision = assessListingCondition({
      source: {
        sourceId: 's4',
        domain: 'store.iq',
        sourceKind: 'retailer',
        sourceChannel: 'website',
        catalogConditionPolicy: 'unknown',
        conditionConfidence: 0.55,
      },
      sourceUrl: 'https://store.iq/products/ps5',
      productName: 'PlayStation 5 Console',
      description: 'official package',
    });

    expect(decision.publishable).toBe(true);
    expect(decision.normalizedCondition).toBe('new');
    expect(decision.reason).toBe('retailer_default_new_policy');
  });
});
