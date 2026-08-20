import type { OfflineSweepReport } from '../domain/contracts';
import type { AssetStore, Clock, MaintenanceStore, PackStore } from '../ports';

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const STALE_PREPARATION_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_OWNER_ASSET_BUDGET_BYTES = 300 * 1024 * 1024;

type TerminalCleanupStore = Pick<
  MaintenanceStore,
  'deleteAttempts' | 'listCleanupCandidates'
>;

type OfflineMaintenanceStore = Pick<MaintenanceStore, 'listStalePackPreparations'> &
  Pick<PackStore, 'markPackPreparationFailed'>;

type TerminalCleanupAssets = Pick<AssetStore, 'purgeSession'>;

type OfflineSweepAssets = Pick<
  AssetStore,
  'collectGarbage' | 'purgeSession' | 'sweepTemporaryAssets'
>;

export interface OfflineSweepOptions {
  readonly ownerAssetBudgetBytes?: number;
  readonly stalePreparationMs?: number;
}

interface StaleRecoveryResult {
  readonly recovered: number;
  readonly failed: boolean;
}

export async function cleanupTerminalAttempts(
  ownerId: string,
  repository: TerminalCleanupStore,
  assets: TerminalCleanupAssets,
  clock: Clock,
  retentionMs = DEFAULT_RETENTION_MS,
): Promise<number> {
  const candidates = await repository.listCleanupCandidates(
    ownerId,
    clock.now() - retentionMs,
  );
  for (const sessionId of candidates) {
    await assets.purgeSession(ownerId, sessionId);
  }
  await repository.deleteAttempts(ownerId, candidates);
  return candidates.length;
}

export async function sweepOfflineStorage(
  ownerId: string,
  repository: OfflineMaintenanceStore,
  assets: OfflineSweepAssets,
  clock: Clock,
  options: OfflineSweepOptions = {},
): Promise<OfflineSweepReport> {
  const failures: OfflineSweepReport['failedStages'][number][] = [];
  const now = clock.now();
  const stale = recoverStalePreparations(
    ownerId,
    repository,
    assets,
    now,
    options.stalePreparationMs ?? STALE_PREPARATION_MS,
  ).catch((): StaleRecoveryResult => ({ recovered: 0, failed: true }));
  const temporary = assets.sweepTemporaryAssets(ownerId).catch(() => {
    failures.push('temporary-assets');
    return 0;
  });
  const garbage = assets
    .collectGarbage(
      ownerId,
      options.ownerAssetBudgetBytes ?? DEFAULT_OWNER_ASSET_BUDGET_BYTES,
      now,
    )
    .catch(() => {
      failures.push('garbage-collection');
      return { removed: 0, bytes: 0 };
    });
  const [staleRecovery, orphanTemporaryAssets, reclaimed] = await Promise.all([
    stale,
    temporary,
    garbage,
  ]);
  if (staleRecovery.failed) failures.push('stale-preparations');
  return {
    abandonedPacks: staleRecovery.recovered,
    orphanTemporaryAssets,
    reclaimedAssets: reclaimed.removed,
    reclaimedBytes: reclaimed.bytes,
    failedStages: [...new Set(failures)].sort(),
  };
}

async function recoverStalePreparations(
  ownerId: string,
  repository: OfflineMaintenanceStore,
  assets: Pick<AssetStore, 'purgeSession'>,
  now: number,
  stalePreparationMs: number,
): Promise<StaleRecoveryResult> {
  const sessionIds = await repository.listStalePackPreparations(
    ownerId,
    now - stalePreparationMs,
  );
  let recovered = 0;
  let failed = false;
  for (const sessionId of sessionIds) {
    try {
      await repository.markPackPreparationFailed(
        ownerId,
        sessionId,
        'PACK_PREPARATION_CANCELLED',
        now,
      );
      await assets.purgeSession(ownerId, sessionId);
      recovered += 1;
    } catch {
      failed = true;
    }
  }
  return { recovered, failed };
}
