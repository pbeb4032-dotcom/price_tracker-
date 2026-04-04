import { describe, expect, it } from 'vitest';
import { computeSourceCertificationDecision } from './sourceCertification';

describe('sourceCertification', () => {
  it('keeps candidate sources in sandbox even after validation', () => {
    const decision = computeSourceCertificationDecision({
      domain: 'candidate.example',
      lifecycleStatus: 'candidate',
      validationState: 'passed',
      validationScore: 0.91,
      observationsLookback: 40,
      gateApproved: 30,
      gateQuarantined: 1,
      trustEffective: 0.82,
    });

    expect(decision.tier).toBe('sandbox');
    expect(decision.publishEnabled).toBe(false);
    expect(decision.status).toBe('pending');
  });

  it('promotes healthy observed sources to published', () => {
    const decision = computeSourceCertificationDecision({
      domain: 'trusted-store.iq',
      lifecycleStatus: 'active',
      validationState: 'passed',
      validationScore: 0.89,
      trustEffective: 0.84,
      errorRate: 0.08,
      anomalyRate: 0.03,
      observationsLookback: 48,
      lastSuccessAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      gateApproved: 36,
      gateQuarantined: 4,
      gateRejected: 1,
    });

    expect(decision.tier).toBe('published');
    expect(decision.status).toBe('certified');
    expect(decision.publishEnabled).toBe(true);
    expect(decision.qualityScore).toBeGreaterThanOrEqual(0.74);
  });

  it('suspends unhealthy sources from public publication', () => {
    const decision = computeSourceCertificationDecision({
      domain: 'broken-source.iq',
      lifecycleStatus: 'active',
      validationState: 'passed',
      validationScore: 0.8,
      trustEffective: 0.7,
      errorRate: 0.91,
      anomalyRate: 0.22,
      observationsLookback: 9,
      autoDisabled: true,
      gateApproved: 1,
      gateQuarantined: 8,
      gateRejected: 3,
    });

    expect(decision.tier).toBe('suspended');
    expect(decision.status).toBe('suspended');
    expect(decision.publishEnabled).toBe(false);
  });
});
