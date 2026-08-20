import type { AssetHealReport, AssetProjection } from '../domain/contracts';
import type { AssetStore, Clock, Connectivity, PackStore } from '../ports';
import { probeConnectivity } from './connectivity-probe';

type AssetHealRepository = Pick<
  PackStore,
  | 'listReadyAssets'
  | 'listPendingAssets'
  | 'markAssetCorrupt'
  | 'markAssetReady'
  | 'markOfflineReady'
>;

type AssetHealStore = Pick<AssetStore, 'isMaterialized' | 'prepare'>;

interface DemotionResult {
  readonly demoted: number;
  readonly cancelled: boolean;
}

interface RepairResult {
  readonly ready: boolean;
  readonly cancelled: boolean;
}

export interface AssetHealOptions {
  readonly clock: Clock;
  readonly connectivity: Connectivity;
  readonly signal?: AbortSignal;
}

export async function healSessionAssets(
  ownerId: string,
  sessionId: string,
  repository: AssetHealRepository,
  assets: AssetHealStore,
  options: AssetHealOptions,
): Promise<AssetHealReport> {
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) return report(0, 0, 0);

  const demotion = await demoteVanishedAssets(
    ownerId,
    sessionId,
    repository,
    assets,
    options.clock.now(),
    signal,
  );
  if (demotion.cancelled || signal.aborted) return report(demotion.demoted, 0, 0);

  const pending = await repository.listPendingAssets(ownerId, sessionId);
  if (signal.aborted) return report(demotion.demoted, 0, pending.length);
  if (pending.length === 0) {
    if (demotion.demoted > 0) {
      if (signal.aborted) return report(demotion.demoted, 0, 0);
      await repository.markOfflineReady(ownerId, sessionId, options.clock.now());
      if (signal.aborted) return report(demotion.demoted, 0, 0);
    }
    return report(demotion.demoted, 0, 0);
  }

  if (signal.aborted) return report(demotion.demoted, 0, pending.length);
  const connectivity = await probeConnectivity(options.connectivity, signal);
  if (connectivity !== 'online' || signal.aborted) {
    return report(demotion.demoted, 0, pending.length);
  }

  let repaired = 0;
  let unrepaired = 0;
  for (let index = 0; index < pending.length; index += 1) {
    if (signal.aborted) {
      unrepaired += pending.length - index;
      break;
    }
    const asset = pending[index];
    if (!asset) break;
    const repair = await repairAsset(
      ownerId,
      sessionId,
      asset,
      repository,
      assets,
      options.clock,
      signal,
    );
    if (repair.ready) repaired += 1;
    else unrepaired += 1;
    if (repair.cancelled || signal.aborted) {
      unrepaired += pending.length - index - 1;
      break;
    }
  }

  if (demotion.demoted + repaired > 0 && unrepaired === 0) {
    if (signal.aborted) return report(demotion.demoted, repaired, unrepaired);
    await repository.markOfflineReady(ownerId, sessionId, options.clock.now());
    if (signal.aborted) return report(demotion.demoted, repaired, unrepaired);
  }
  return report(demotion.demoted, repaired, unrepaired);
}

async function demoteVanishedAssets(
  ownerId: string,
  sessionId: string,
  repository: Pick<PackStore, 'listReadyAssets' | 'markAssetCorrupt'>,
  assets: Pick<AssetStore, 'isMaterialized'>,
  now: number,
  signal: AbortSignal,
): Promise<DemotionResult> {
  if (signal.aborted) return { demoted: 0, cancelled: true };
  const ready = await repository.listReadyAssets(ownerId, sessionId);
  if (signal.aborted) return { demoted: 0, cancelled: true };

  let demoted = 0;
  for (const asset of ready) {
    if (signal.aborted) return { demoted, cancelled: true };
    if (asset.storageKey !== null) {
      const materialized = await assets.isMaterialized(asset.storageKey, asset.sizeBytes);
      if (signal.aborted) return { demoted, cancelled: true };
      if (materialized) continue;
    }
    if (signal.aborted) return { demoted, cancelled: true };
    await repository.markAssetCorrupt(ownerId, sessionId, asset.assetId, now);
    demoted += 1;
    if (signal.aborted) return { demoted, cancelled: true };
  }
  return { demoted, cancelled: false };
}

async function repairAsset(
  ownerId: string,
  sessionId: string,
  asset: AssetProjection,
  repository: Pick<PackStore, 'markAssetReady'>,
  assets: Pick<AssetStore, 'prepare'>,
  clock: Clock,
  signal: AbortSignal,
): Promise<RepairResult> {
  if (signal.aborted) return { ready: false, cancelled: true };
  try {
    const storageKey = await assets.prepare(ownerId, sessionId, asset, signal);
    if (signal.aborted) return { ready: false, cancelled: true };
    await repository.markAssetReady(ownerId, sessionId, asset.assetId, storageKey, clock.now());
    return { ready: true, cancelled: signal.aborted };
  } catch {
    return { ready: false, cancelled: signal.aborted };
  }
}

function report(demoted: number, repaired: number, unrepaired: number): AssetHealReport {
  return { demoted, repaired, unrepaired };
}
