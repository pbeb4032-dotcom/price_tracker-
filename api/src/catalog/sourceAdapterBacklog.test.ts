import { describe, expect, it } from 'vitest';
import { computeSourceAdapterBacklogTransition, computeSourceAdapterExecutionScore } from './sourceAdapterBacklog';

describe('sourceAdapterBacklog', () => {
  it('opens a pending task with the recommended path', () => {
    const transition = computeSourceAdapterBacklogTransition({
      action: 'open_task',
      recommendedPath: 'api',
    });

    expect(transition.status).toBe('pending');
    expect(transition.assignedPath).toBe('api');
  });

  it('assigns render work explicitly', () => {
    const transition = computeSourceAdapterBacklogTransition({
      action: 'assign_render',
      recommendedPath: 'html',
    });

    expect(transition.status).toBe('assigned');
    expect(transition.assignedPath).toBe('render');
  });

  it('marks postponed items as hold', () => {
    const transition = computeSourceAdapterBacklogTransition({
      action: 'mark_postponed',
      currentAssignedPath: 'api',
      recommendedPath: 'api',
    });

    expect(transition.status).toBe('postponed');
    expect(transition.assignedPath).toBe('hold');
  });

  it('reopens completed items while keeping assigned path', () => {
    const transition = computeSourceAdapterBacklogTransition({
      action: 'reopen',
      currentStatus: 'completed',
      currentAssignedPath: 'mobile_adapter',
      recommendedPath: 'mobile_adapter',
    });

    expect(transition.status).toBe('pending');
    expect(transition.assignedPath).toBe('mobile_adapter');
  });

  it('prioritizes healthy API work over postponed hold work', () => {
    const api = computeSourceAdapterExecutionScore({
      queuePath: 'api',
      backlogStatus: 'assigned',
      sourcePriority: 60,
      qualityScore: 0.82,
      trustEffective: 0.8,
      errorRate: 0.08,
      successes: 40,
      certificationTier: 'published',
    });
    const hold = computeSourceAdapterExecutionScore({
      queuePath: 'hold',
      backlogStatus: 'pending',
      sourcePriority: 120,
      qualityScore: 0.55,
      trustEffective: 0.52,
      errorRate: 0.3,
      successes: 4,
      certificationTier: 'sandbox',
    });

    expect(api.executionScore).toBeGreaterThan(hold.executionScore);
    expect(api.impactScore).toBeGreaterThan(hold.impactScore);
  });
});
