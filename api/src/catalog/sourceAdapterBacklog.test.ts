import { describe, expect, it } from 'vitest';
import { computeSourceAdapterBacklogTransition } from './sourceAdapterBacklog';

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
});
