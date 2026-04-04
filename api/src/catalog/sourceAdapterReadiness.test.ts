import { describe, expect, it } from 'vitest';
import { computeSourceAdapterReadiness } from './sourceAdapterReadiness';

describe('sourceAdapterReadiness', () => {
  it('marks structured API sources with endpoints as api-ready', () => {
    const decision = computeSourceAdapterReadiness({
      domain: 'trusted-api.iq',
      adapterStrategy: 'structured_api',
      activeApiEndpoints: 3,
      activeEntrypoints: 1,
    });

    expect(decision.readinessClass).toBe('api_ready');
    expect(decision.recommendedPath).toBe('api');
    expect(decision.reasons).toContain('active_api_endpoints_present');
  });

  it('marks mobile sources without endpoints as needing a mobile adapter', () => {
    const decision = computeSourceAdapterReadiness({
      domain: 'app-only.iq',
      sourceChannel: 'mobile_app',
      adapterStrategy: 'mobile_api',
      activeApiEndpoints: 0,
      activeEntrypoints: 0,
    });

    expect(decision.readinessClass).toBe('needs_mobile_adapter');
    expect(decision.recommendedPath).toBe('mobile_adapter');
  });

  it('marks js-only sources as needing render', () => {
    const decision = computeSourceAdapterReadiness({
      domain: 'spa-store.iq',
      adapterStrategy: 'rendered_html',
      jsOnly: true,
      activeEntrypoints: 4,
    });

    expect(decision.readinessClass).toBe('needs_render');
    expect(decision.recommendedPath).toBe('render');
  });

  it('postpones unstable suspended sources', () => {
    const decision = computeSourceAdapterReadiness({
      domain: 'broken-source.iq',
      certificationTier: 'suspended',
      autoDisabled: true,
      errorRate: 0.88,
      failures: 9,
    });

    expect(decision.readinessClass).toBe('postpone');
    expect(decision.recommendedPath).toBe('hold');
    expect(decision.reasons).toContain('auto_disabled');
  });
});
