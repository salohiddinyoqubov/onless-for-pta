import {
  cleanupTerminalAttempts,
  sweepOfflineStorage,
} from '../src/exam/offline/cleanup';
import { healSessionAssets } from '../src/exam/offline/self-heal';
import type { Connectivity } from '../src/exam/ports';
import {
  DEMO_OWNER_ID,
  DEMO_SESSION_ID,
  SECOND_SESSION_ID,
  FakeAssetStore,
  ManualClock,
  MemoryRepository,
  MutableConnectivity,
  assetProjection,
  deferred,
} from './fixtures';
function heal(
  repository: MemoryRepository,
  assets: FakeAssetStore,
  controller: AbortController,
  connectivity: Connectivity = new MutableConnectivity(true),
) {
  return healSessionAssets(DEMO_OWNER_ID, DEMO_SESSION_ID, repository, assets, {
    clock: new ManualClock(),
    connectivity,
    signal: controller.signal,
  });
}
describe('terminal retention and offline sweeping', () => {
  it('purges repository-approved attempts before deleting durable rows', async () => {
    const repository = new MemoryRepository();
    repository.cleanupCandidates = [DEMO_SESSION_ID, SECOND_SESSION_ID];
    const assets = new FakeAssetStore();
    const timeline: string[] = [];
    jest.spyOn(assets, 'purgeSession').mockImplementation(async (_ownerId, sessionId) => {
      timeline.push(`purge:${sessionId}`);
    });
    jest.spyOn(repository, 'deleteAttempts').mockImplementation(async (_ownerId, sessionIds) => {
      timeline.push(`delete:${sessionIds.join(',')}`);
    });
    await expect(
      cleanupTerminalAttempts(
        DEMO_OWNER_ID,
        repository,
        assets,
        new ManualClock(50_000),
        5_000,
      ),
    ).resolves.toBe(2);
    expect(timeline).toEqual([
      `purge:${DEMO_SESSION_ID}`,
      `purge:${SECOND_SESSION_ID}`,
      `delete:${DEMO_SESSION_ID},${SECOND_SESSION_ID}`,
    ]);
    expect(repository.listCleanupCandidates).toBeDefined();
  });
  it('does not delete rows when any approved asset purge fails', async () => {
    const repository = new MemoryRepository();
    repository.cleanupCandidates = [DEMO_SESSION_ID];
    const assets = new FakeAssetStore();
    assets.purgeError = new Error('Synthetic purge failure');
    const deleteAttempts = jest.spyOn(repository, 'deleteAttempts');
    await expect(
      cleanupTerminalAttempts(DEMO_OWNER_ID, repository, assets, new ManualClock()),
    ).rejects.toThrow('Synthetic purge failure');
    expect(deleteAttempts).not.toHaveBeenCalled();
  });
  it('passes an injected retention cutoff to the repository', async () => {
    const repository = new MemoryRepository();
    const listCandidates = jest.spyOn(repository, 'listCleanupCandidates');
    await cleanupTerminalAttempts(
      DEMO_OWNER_ID,
      repository,
      new FakeAssetStore(),
      new ManualClock(100_000),
      25_000,
    );
    expect(listCandidates).toHaveBeenCalledWith(DEMO_OWNER_ID, 75_000);
  });
  it('recovers stale preparations, temporary assets, and garbage independently', async () => {
    const repository = new MemoryRepository();
    repository.stalePreparations = [DEMO_SESSION_ID];
    const assets = new FakeAssetStore();
    assets.temporaryAssets = 2;
    assets.garbage = { removed: 3, bytes: 1_024 };
    const timeline: string[] = [];
    jest
      .spyOn(repository, 'markPackPreparationFailed')
      .mockImplementation(async (_ownerId, sessionId) => {
        timeline.push(`mark-failed:${sessionId}`);
      });
    jest.spyOn(assets, 'purgeSession').mockImplementation(async (_ownerId, sessionId) => {
      timeline.push(`purge:${sessionId}`);
    });
    await expect(
      sweepOfflineStorage(
        DEMO_OWNER_ID,
        repository,
        assets,
        new ManualClock(200_000),
        { stalePreparationMs: 50_000, ownerAssetBudgetBytes: 4_096 },
      ),
    ).resolves.toEqual({
      abandonedPacks: 1,
      orphanTemporaryAssets: 2,
      reclaimedAssets: 3,
      reclaimedBytes: 1_024,
      failedStages: [],
    });
    expect(timeline).toEqual([
      `mark-failed:${DEMO_SESSION_ID}`,
      `purge:${DEMO_SESSION_ID}`,
    ]);
  });
  it('reports failed stages while allowing the other stages to reclaim data', async () => {
    const repository = new MemoryRepository();
    repository.stalePreparations = [DEMO_SESSION_ID];
    repository.compensationError = new Error('Synthetic stale-row failure');
    const assets = new FakeAssetStore();
    assets.temporaryError = new Error('Synthetic temporary sweep failure');
    assets.garbage = { removed: 4, bytes: 2_048 };
    const report = await sweepOfflineStorage(
      DEMO_OWNER_ID,
      repository,
      assets,
      new ManualClock(),
    );
    expect(report).toEqual({
      abandonedPacks: 0,
      orphanTemporaryAssets: 0,
      reclaimedAssets: 4,
      reclaimedBytes: 2_048,
      failedStages: ['stale-preparations', 'temporary-assets'],
    });
    expect(assets.events).toContain(`collect-garbage:${DEMO_OWNER_ID}`);
  });
  it('counts stale packs recovered before a later session fails', async () => {
    const repository = new MemoryRepository();
    repository.stalePreparations = [DEMO_SESSION_ID, SECOND_SESSION_ID];
    jest
      .spyOn(repository, 'markPackPreparationFailed')
      .mockImplementation(async (_ownerId, sessionId) => {
        if (sessionId === SECOND_SESSION_ID) throw new Error('Synthetic durable failure');
      });
    await expect(
      sweepOfflineStorage(
        DEMO_OWNER_ID,
        repository,
        new FakeAssetStore(),
        new ManualClock(),
      ),
    ).resolves.toMatchObject({
      abandonedPacks: 1,
      failedStages: ['stale-preparations'],
    });
  });
});
describe('healSessionAssets', () => {
  it('does not read or write durable state when already cancelled', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const controller = new AbortController();
    controller.abort();
    const listReady = jest.spyOn(repository, 'listReadyAssets');
    await expect(heal(repository, assets, controller)).resolves.toEqual({
      demoted: 0, repaired: 0, unrepaired: 0,
    });
    expect(listReady).not.toHaveBeenCalled();
    expect(repository.events).toEqual([]);
  });
  it('stops after cancellation races the ready-asset read', async () => {
    const repository = new MemoryRepository();
    const controller = new AbortController();
    jest.spyOn(repository, 'listReadyAssets').mockImplementation(async () => {
      controller.abort();
      return [assetProjection(1, { state: 'ready', storageKey: null })];
    });
    const listPending = jest.spyOn(repository, 'listPendingAssets');
    await expect(heal(repository, new FakeAssetStore(), controller)).resolves.toEqual({
      demoted: 0, repaired: 0, unrepaired: 0,
    });
    expect(listPending).not.toHaveBeenCalled();
    expect(repository.events).toEqual([]);
  });
  it('does not demote an asset when cancellation wins its materialization check', async () => {
    const repository = new MemoryRepository();
    repository.readyAssets = [
      assetProjection(1, { state: 'ready', storageKey: 'asset:checking' }),
    ];
    const assets = new FakeAssetStore();
    const checkStarted = deferred<void>();
    const check = deferred<boolean>();
    jest.spyOn(assets, 'isMaterialized').mockImplementation(async () => {
      checkStarted.resolve();
      return check.promise;
    });
    const controller = new AbortController();
    const healing = heal(repository, assets, controller);
    await checkStarted.promise;
    controller.abort();
    check.resolve(false);
    await expect(healing).resolves.toEqual({ demoted: 0, repaired: 0, unrepaired: 0 });
    expect(repository.events).toEqual([]);
  });
  it('starts no later boundary after cancellation during a durable demotion', async () => {
    const repository = new MemoryRepository();
    repository.readyAssets = [
      assetProjection(1, { state: 'ready', storageKey: 'asset:vanished' }),
    ];
    const demotionStarted = deferred<void>();
    const finishDemotion = deferred<void>();
    jest.spyOn(repository, 'markAssetCorrupt').mockImplementation(async () => {
      demotionStarted.resolve();
      return finishDemotion.promise;
    });
    const listPending = jest.spyOn(repository, 'listPendingAssets');
    const controller = new AbortController();
    const healing = heal(repository, new FakeAssetStore(), controller);
    await demotionStarted.promise;
    controller.abort();
    finishDemotion.resolve();
    await expect(healing).resolves.toEqual({ demoted: 1, repaired: 0, unrepaired: 0 });
    expect(listPending).not.toHaveBeenCalled();
  });
  it('does not probe connectivity after cancellation races the pending read', async () => {
    const repository = new MemoryRepository();
    const controller = new AbortController();
    jest.spyOn(repository, 'listPendingAssets').mockImplementation(async () => {
      controller.abort();
      return [assetProjection(1)];
    });
    const connectivity = new MutableConnectivity(true);
    const probe = jest.spyOn(connectivity, 'isOnline');
    await expect(heal(repository, new FakeAssetStore(), controller, connectivity)).resolves.toEqual({
      demoted: 0, repaired: 0, unrepaired: 1,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(repository.events).toEqual([]);
  });
  it('cancels a connectivity probe that never settles and starts no asset work', async () => {
    const repository = new MemoryRepository();
    repository.pendingAssets = [assetProjection(1)];
    const probeStarted = deferred<void>();
    const observedSignals: AbortSignal[] = [];
    const connectivity: Connectivity = {
      isOnline: (signal) => {
        observedSignals.push(signal);
        probeStarted.resolve();
        return new Promise<boolean>(() => undefined);
      },
    };
    const controller = new AbortController();
    const assets = new FakeAssetStore();
    const healing = heal(repository, assets, controller, connectivity);
    await probeStarted.promise;
    controller.abort();
    await expect(healing).resolves.toEqual({ demoted: 0, repaired: 0, unrepaired: 1 });
    expect(observedSignals[0]?.aborted).toBe(true);
    expect(assets.events).toEqual([]);
    expect(repository.events).toEqual([]);
  });
  it('leaves a fully materialized pack untouched', async () => {
    const repository = new MemoryRepository();
    const ready = assetProjection(1, { state: 'ready', storageKey: 'asset:ready' });
    repository.readyAssets = [ready];
    const assets = new FakeAssetStore();
    assets.materialized.set('asset:ready', ready.sizeBytes);
    await expect(
      healSessionAssets(DEMO_OWNER_ID, DEMO_SESSION_ID, repository, assets, {
        clock: new ManualClock(),
        connectivity: new MutableConnectivity(false),
      }),
    ).resolves.toEqual({ demoted: 0, repaired: 0, unrepaired: 0 });
    expect(repository.events).toEqual([]);
    expect(assets.events).toEqual([]);
  });
  it('demotes a vanished ready asset, repairs it, then reasserts readiness', async () => {
    const repository = new MemoryRepository();
    repository.readyAssets = [
      assetProjection(1, { state: 'ready', storageKey: 'asset:vanished' }),
    ];
    const assets = new FakeAssetStore();
    await expect(
      healSessionAssets(DEMO_OWNER_ID, DEMO_SESSION_ID, repository, assets, {
        clock: new ManualClock(),
        connectivity: new MutableConnectivity(true),
      }),
    ).resolves.toEqual({ demoted: 1, repaired: 1, unrepaired: 0 });
    expect(repository.events).toEqual([
      `asset-corrupt:70000000-0000-4000-8000-000000000001`,
      `asset-ready:70000000-0000-4000-8000-000000000001`,
      `offline-ready:${DEMO_OWNER_ID}:${DEMO_SESSION_ID}`,
    ]);
  });
  it('does not cross the asset preparation boundary while offline', async () => {
    const repository = new MemoryRepository();
    repository.pendingAssets = [assetProjection(1), assetProjection(2)];
    const assets = new FakeAssetStore();
    await expect(
      healSessionAssets(DEMO_OWNER_ID, DEMO_SESSION_ID, repository, assets, {
        clock: new ManualClock(),
        connectivity: new MutableConnectivity(false),
      }),
    ).resolves.toEqual({ demoted: 0, repaired: 0, unrepaired: 2 });
    expect(assets.events).toEqual([]);
    expect(repository.events).toEqual([]);
  });
  it('keeps readiness false while any pending asset remains unrepaired', async () => {
    const repository = new MemoryRepository();
    repository.pendingAssets = [assetProjection(1), assetProjection(2)];
    const assets = new FakeAssetStore();
    assets.prepareHandler = async (_ownerId, _sessionId, asset) => {
      if (asset.assetId.endsWith('000002')) throw new Error('Synthetic asset unavailable');
      return `asset:${asset.assetId}`;
    };
    await expect(
      healSessionAssets(DEMO_OWNER_ID, DEMO_SESSION_ID, repository, assets, {
        clock: new ManualClock(),
        connectivity: new MutableConnectivity(true),
      }),
    ).resolves.toEqual({ demoted: 0, repaired: 1, unrepaired: 1 });
    expect(repository.events.some((event) => event.startsWith('offline-ready:'))).toBe(false);
  });
  it('stops starting new repairs after cancellation and reports the remainder', async () => {
    const repository = new MemoryRepository();
    repository.pendingAssets = [assetProjection(1), assetProjection(2), assetProjection(3)];
    const assets = new FakeAssetStore();
    const controller = new AbortController();
    assets.prepareHandler = async (_ownerId, _sessionId, asset) => {
      controller.abort();
      return `asset:${asset.assetId}`;
    };
    await expect(
      healSessionAssets(DEMO_OWNER_ID, DEMO_SESSION_ID, repository, assets, {
        clock: new ManualClock(),
        connectivity: new MutableConnectivity(true),
        signal: controller.signal,
      }),
    ).resolves.toEqual({ demoted: 0, repaired: 0, unrepaired: 3 });
    expect(assets.events).toHaveLength(1);
    expect(repository.events).toEqual([]);
  });
  it('does not mark a pack ready after cancellation races an asset-ready write', async () => {
    const repository = new MemoryRepository();
    repository.pendingAssets = [assetProjection(1)];
    const readyStarted = deferred<void>();
    const finishReady = deferred<void>();
    jest.spyOn(repository, 'markAssetReady').mockImplementation(async () => {
      readyStarted.resolve();
      return finishReady.promise;
    });
    const markOfflineReady = jest.spyOn(repository, 'markOfflineReady');
    const controller = new AbortController();
    const healing = heal(repository, new FakeAssetStore(), controller);
    await readyStarted.promise;
    controller.abort();
    finishReady.resolve();
    await expect(healing).resolves.toEqual({ demoted: 0, repaired: 1, unrepaired: 0 });
    expect(markOfflineReady).not.toHaveBeenCalled();
  });
  it('propagates unreadable durable storage instead of claiming a no-op', async () => {
    const repository = new MemoryRepository();
    jest
      .spyOn(repository, 'listReadyAssets')
      .mockRejectedValue(new Error('Synthetic storage unavailable'));
    await expect(
      healSessionAssets(
        DEMO_OWNER_ID,
        DEMO_SESSION_ID,
        repository,
        new FakeAssetStore(),
        {
          clock: new ManualClock(),
          connectivity: new MutableConnectivity(true),
        },
      ),
    ).rejects.toThrow('Synthetic storage unavailable');
  });
});
