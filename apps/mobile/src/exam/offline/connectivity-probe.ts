import type { Connectivity } from '../ports';

export type ConnectivityProbeResult = 'online' | 'offline' | 'aborted';

export function probeConnectivity(
  connectivity: Connectivity,
  signal: AbortSignal,
): Promise<ConnectivityProbeResult> {
  if (signal.aborted) return Promise.resolve('aborted');

  return new Promise<ConnectivityProbeResult>((resolve, reject) => {
    let settled = false;
    const finish = (
      result: ConnectivityProbeResult,
      error?: unknown,
    ): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error === undefined) resolve(result);
      else {
        reject(
          error instanceof Error
            ? error
            : new Error('Connectivity probe failed.', { cause: error }),
        );
      }
    };
    const onAbort = (): void => finish('aborted');
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      void connectivity.isOnline(signal).then(
        (online) => finish(online ? 'online' : 'offline'),
        (error: unknown) => finish('offline', error),
      );
    } catch (error) {
      finish('offline', error);
    }
  });
}
