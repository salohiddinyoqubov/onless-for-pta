import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DashboardDataError,
  type DashboardDataSource,
  type DashboardSnapshot,
} from '../domain/contracts.js';

export type DashboardLoadState =
  | { readonly status: 'loading'; readonly snapshot: null; readonly error: null }
  | { readonly status: 'ready'; readonly snapshot: DashboardSnapshot; readonly error: null }
  | { readonly status: 'refreshing'; readonly snapshot: DashboardSnapshot; readonly error: null }
  | {
      readonly status: 'error';
      readonly snapshot: DashboardSnapshot | null;
      readonly error: DashboardDataError;
    };

function normalizeError(error: unknown): DashboardDataError {
  return error instanceof DashboardDataError
    ? error
    : new DashboardDataError('unavailable', 'Fixture data source did not return a dashboard');
}

function loadDashboardSafely(
  dataSource: DashboardDataSource,
  signal: AbortSignal,
): Promise<DashboardSnapshot> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
  }
  try {
    return Promise.resolve(dataSource.load(signal));
  } catch (error) {
    return Promise.reject(normalizeError(error));
  }
}

export function useRefreshOnResume(
  refresh: () => void,
  activationRevision: number,
): void {
  const lastActivationRevision = useRef(activationRevision);

  useEffect(() => {
    if (lastActivationRevision.current === activationRevision) return;
    lastActivationRevision.current = activationRevision;
    refresh();
  }, [activationRevision, refresh]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => { document.removeEventListener('visibilitychange', handleVisibility); };
  }, [refresh]);
}

export function useDashboard(
  dataSource: DashboardDataSource,
  activationRevision: number,
): DashboardLoadState & { readonly refresh: () => void } {
  const [state, setState] = useState<DashboardLoadState>({
    status: 'loading',
    snapshot: null,
    error: null,
  });
  const [refreshRevision, setRefreshRevision] = useState(0);
  const requestSequence = useRef(0);

  const refresh = useCallback(() => {
    setState((current) =>
      current.snapshot
        ? { status: 'refreshing', snapshot: current.snapshot, error: null }
        : { status: 'loading', snapshot: null, error: null },
    );
    setRefreshRevision((revision) => revision + 1);
  }, []);

  useRefreshOnResume(refresh, activationRevision);

  useEffect(() => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const controller = new AbortController();
    let active = true;

    void loadDashboardSafely(dataSource, controller.signal)
      .then((snapshot) => {
        if (!active || requestId !== requestSequence.current) return;
        setState({ status: 'ready', snapshot, error: null });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted || requestId !== requestSequence.current) return;
        setState((current) => ({
          status: 'error',
          snapshot: current.snapshot,
          error: normalizeError(error),
        }));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [dataSource, refreshRevision]);

  return { ...state, refresh };
}
