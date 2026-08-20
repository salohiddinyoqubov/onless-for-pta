import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  DashboardDataSource,
  DashboardSnapshot,
} from '../src/domain/contracts.js';
import { DEMO_DASHBOARD_SNAPSHOT } from '../src/demo/fixture-data-source.js';
import { useDashboard } from '../src/dashboard/use-dashboard.js';

interface PendingLoad {
  readonly signal: AbortSignal;
  readonly resolve: (snapshot: DashboardSnapshot) => void;
  readonly reject: (error: unknown) => void;
}

class DeferredDataSource implements DashboardDataSource {
  public readonly calls: PendingLoad[] = [];

  public load(signal: AbortSignal): Promise<DashboardSnapshot> {
    return new Promise((resolve, reject) => {
      this.calls.push({ signal, resolve, reject });
    });
  }
}

class SynchronouslyThrowingDataSource implements DashboardDataSource {
  public calls = 0;

  public load(): Promise<DashboardSnapshot> {
    this.calls += 1;
    throw new Error('synchronous private detail');
  }
}

function withCompletedTests(completedTests: number): DashboardSnapshot {
  return {
    ...DEMO_DASHBOARD_SNAPSHOT,
    summary: {
      ...DEMO_DASHBOARD_SNAPSHOT.summary,
      stats: { ...DEMO_DASHBOARD_SNAPSHOT.summary.stats, completedTests },
    },
  };
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useDashboard', () => {
  it('loads once and publishes a ready snapshot', async () => {
    const source = new DeferredDataSource();
    const { result } = renderHook(() => useDashboard(source, 0));
    expect(result.current.status).toBe('loading');
    expect(source.calls).toHaveLength(1);

    act(() => {
      source.calls[0]?.resolve(DEMO_DASHBOARD_SNAPSHOT);
    });
    await waitFor(() => { expect(result.current.status).toBe('ready'); });
    expect(result.current.snapshot).toBe(DEMO_DASHBOARD_SNAPSHOT);
  });

  it('aborts the active request when the consumer unmounts', () => {
    const source = new DeferredDataSource();
    const { unmount } = renderHook(() => useDashboard(source, 0));
    expect(source.calls[0]?.signal.aborted).toBe(false);
    unmount();
    expect(source.calls[0]?.signal.aborted).toBe(true);
  });

  it('retains ready data while a manual refresh is pending', async () => {
    const source = new DeferredDataSource();
    const { result } = renderHook(() => useDashboard(source, 0));
    act(() => {
      source.calls[0]?.resolve(DEMO_DASHBOARD_SNAPSHOT);
    });
    await waitFor(() => { expect(result.current.status).toBe('ready'); });

    act(() => { result.current.refresh(); });
    expect(result.current.status).toBe('refreshing');
    expect(result.current.snapshot).toBe(DEMO_DASHBOARD_SNAPSHOT);
    await waitFor(() => { expect(source.calls).toHaveLength(2); });
  });

  it('suppresses an older response even when its source ignores cancellation', async () => {
    const source = new DeferredDataSource();
    const { result, rerender } = renderHook(
      ({ revision }) => useDashboard(source, revision),
      { initialProps: { revision: 0 } },
    );
    expect(source.calls).toHaveLength(1);

    rerender({ revision: 1 });
    await waitFor(() => { expect(source.calls).toHaveLength(2); });
    rerender({ revision: 2 });
    await waitFor(() => { expect(source.calls).toHaveLength(3); });

    const newest = withCompletedTests(33);
    act(() => {
      source.calls[2]?.resolve(newest);
    });
    await waitFor(() => {
      expect(result.current.snapshot?.summary.stats.completedTests).toBe(33);
    });

    act(() => {
      source.calls[1]?.resolve(withCompletedTests(2));
    });
    await waitFor(() => {
      expect(result.current.snapshot?.summary.stats.completedTests).toBe(33);
    });
    expect(source.calls[1]?.signal.aborted).toBe(true);
  });

  it('refreshes only when the document resumes visibly', async () => {
    const source = new DeferredDataSource();
    renderHook(() => useDashboard(source, 0));
    expect(source.calls).toHaveLength(1);

    act(() => { setVisibility('hidden'); });
    expect(source.calls).toHaveLength(1);
    act(() => { setVisibility('visible'); });
    await waitFor(() => { expect(source.calls).toHaveLength(2); });
    act(() => { setVisibility('visible'); });
    await waitFor(() => { expect(source.calls).toHaveLength(3); });
  });

  it('normalizes unknown failures and allows a retry', async () => {
    const source = new DeferredDataSource();
    const { result } = renderHook(() => useDashboard(source, 0));
    act(() => {
      source.calls[0]?.reject(new Error('internal detail'));
    });
    await waitFor(() => { expect(result.current.status).toBe('error'); });
    expect(result.current.error?.code).toBe('unavailable');
    expect(result.current.error?.message).not.toContain('internal detail');

    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(source.calls).toHaveLength(2); });
    act(() => {
      source.calls[1]?.resolve(DEMO_DASHBOARD_SNAPSHOT);
    });
    await waitFor(() => { expect(result.current.status).toBe('ready'); });
  });

  it('normalizes a synchronous data-source throw through the async error lifecycle', async () => {
    const source = new SynchronouslyThrowingDataSource();
    const { result } = renderHook(() => useDashboard(source, 0));

    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(source.calls).toBe(1);
    expect(result.current.error?.code).toBe('unavailable');
    expect(result.current.error?.message).not.toContain('synchronous private detail');

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => {
      expect(source.calls).toBe(2);
      expect(result.current.status).toBe('error');
    });
  });

  it('keeps the previous snapshot visible when refresh fails', async () => {
    const source = new DeferredDataSource();
    const { result } = renderHook(() => useDashboard(source, 0));
    act(() => {
      source.calls[0]?.resolve(DEMO_DASHBOARD_SNAPSHOT);
    });
    await waitFor(() => { expect(result.current.status).toBe('ready'); });
    act(() => { result.current.refresh(); });
    await waitFor(() => { expect(source.calls).toHaveLength(2); });
    act(() => {
      source.calls[1]?.reject(new Error('unavailable'));
    });
    await waitFor(() => { expect(result.current.status).toBe('error'); });
    expect(result.current.snapshot).toBe(DEMO_DASHBOARD_SNAPSHOT);
  });
});
