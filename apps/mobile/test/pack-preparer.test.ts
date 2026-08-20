import { ExamOfflineError } from '../src/exam/domain/errors';
import {
  EXAM_PACK_ASSET_CONCURRENCY,
  ExamPackPreparer,
} from '../src/exam/offline/pack-preparer';
import {
  DEMO_OWNER_ID,
  DEMO_SESSION_ID,
  FakeAssetStore,
  ManualClock,
  MemoryRepository,
  assetDescriptor,
  deferred,
  wireManifest,
} from './fixtures';
async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
describe('ExamPackPreparer', () => {
  it('reports deterministic asset and byte progress', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const progress: Array<{
      completedAssets: number;
      totalAssets: number;
      completedBytes: number;
      totalBytes: number;
    }> = [];
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    await preparer.prepare({
      ownerId: DEMO_OWNER_ID,
      wireManifest: wireManifest(3),
      onProgress: (next) => progress.push(next),
    });
    expect(progress[0]).toEqual({
      completedAssets: 0,
      totalAssets: 3,
      completedBytes: 0,
      totalBytes: 600,
    });
    expect(progress.at(-1)).toEqual({
      completedAssets: 3,
      totalAssets: 3,
      completedBytes: 600,
      totalBytes: 600,
    });
    expect(repository.events.at(-1)).toBe(`offline-ready:${DEMO_OWNER_ID}:${DEMO_SESSION_ID}`);
  });
  it('bounds concurrent preparation to the exported mobile limit', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const gate = deferred<void>();
    assets.prepareHandler = async (_ownerId, _sessionId, asset) => {
      await gate.promise;
      return `asset:${asset.assetId}`;
    };
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    const preparation = preparer.prepare({
      ownerId: DEMO_OWNER_ID,
      wireManifest: wireManifest(9),
    });
    await flushAsyncWork();
    expect(assets.activePreparations).toBe(EXAM_PACK_ASSET_CONCURRENCY);
    expect(assets.maximumActivePreparations).toBe(EXAM_PACK_ASSET_CONCURRENCY);
    gate.resolve();
    await preparation;
    expect(assets.maximumActivePreparations).toBe(EXAM_PACK_ASSET_CONCURRENCY);
  });
  it('marks the asset that actually failed and compensates durable state before purge', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const failedId = assetDescriptor(2).assetId;
    assets.prepareHandler = async (_ownerId, _sessionId, asset) => {
      if (asset.assetId === failedId) throw new Error('Synthetic integrity failure');
      return `asset:${asset.assetId}`;
    };
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    await expect(
      preparer.prepare({ ownerId: DEMO_OWNER_ID, wireManifest: wireManifest(3) }),
    ).rejects.toThrow('Synthetic integrity failure');
    expect(repository.events).toContain(`asset-corrupt:${failedId}`);
    const durableFailure = repository.events.findIndex((event) => event.startsWith('pack-failed:'));
    const purge = assets.events.findIndex((event) => event.startsWith('purge:'));
    expect(durableFailure).toBeGreaterThanOrEqual(0);
    expect(purge).toBeGreaterThanOrEqual(0);
    expect(repository.events).not.toContain(`offline-ready:${DEMO_OWNER_ID}:${DEMO_SESSION_ID}`);
  });
  it('settles every in-flight asset before destructive compensation', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const slow = deferred<string>();
    const firstId = assetDescriptor(1).assetId;
    const secondId = assetDescriptor(2).assetId;
    assets.prepareHandler = async (_ownerId, _sessionId, asset) => {
      if (asset.assetId === firstId) return slow.promise;
      if (asset.assetId === secondId) throw new Error('Synthetic second asset failure');
      return `asset:${asset.assetId}`;
    };
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    const preparation = preparer.prepare({
      ownerId: DEMO_OWNER_ID,
      wireManifest: wireManifest(3),
    });
    await flushAsyncWork();
    expect(assets.events.some((event) => event.startsWith('purge:'))).toBe(false);
    slow.resolve(`asset:${firstId}`);
    await expect(preparation).rejects.toThrow('Synthetic second asset failure');
    expect(assets.activePreparations).toBe(0);
    expect(assets.events.at(-1)).toBe(`purge:${DEMO_OWNER_ID}:${DEMO_SESSION_ID}`);
  });
  it('cancelSession aborts and awaits the run before returning', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    assets.prepareHandler = async (_ownerId, _sessionId, _asset, signal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Synthetic abort')), { once: true });
      });
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    const preparation = preparer.prepare({
      ownerId: DEMO_OWNER_ID,
      wireManifest: wireManifest(2),
    });
    await flushAsyncWork();
    await expect(preparer.cancelSession(DEMO_OWNER_ID, DEMO_SESSION_ID)).resolves.toBeUndefined();
    await expect(preparation).rejects.toThrow('Synthetic abort');
    expect(repository.events).toContain(
      `pack-failed:${DEMO_OWNER_ID}:${DEMO_SESSION_ID}:PACK_PREPARATION_CANCELLED`,
    );
    expect(repository.events).not.toContain(`offline-ready:${DEMO_OWNER_ID}:${DEMO_SESSION_ID}`);
    expect(assets.activePreparations).toBe(0);
  });
  it('cancelOwner blocks new work until explicit activation', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    await preparer.cancelOwner(DEMO_OWNER_ID);
    await expect(
      preparer.prepare({ ownerId: DEMO_OWNER_ID, wireManifest: wireManifest(0) }),
    ).rejects.toMatchObject({ code: 'OWNER_INACTIVE' });
    preparer.activateOwner(DEMO_OWNER_ID);
    await expect(
      preparer.prepare({ ownerId: DEMO_OWNER_ID, wireManifest: wireManifest(0) }),
    ).resolves.toBeUndefined();
  });
  it('compensates cancellation that races the offline-ready durable write', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const readyWrite = deferred<void>();
    jest.spyOn(repository, 'markOfflineReady').mockImplementation(async () => readyWrite.promise);
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    const preparation = preparer.prepare({
      ownerId: DEMO_OWNER_ID,
      wireManifest: wireManifest(1),
    });
    await flushAsyncWork();
    const cancellation = preparer.cancelSession(DEMO_OWNER_ID, DEMO_SESSION_ID);
    readyWrite.resolve();
    await expect(cancellation).resolves.toBeUndefined();
    await expect(preparation).rejects.toMatchObject({ code: 'PREPARATION_CANCELLED' });
    expect(repository.events).toContain(
      `pack-failed:${DEMO_OWNER_ID}:${DEMO_SESSION_ID}:PACK_PREPARATION_CANCELLED`,
    );
    expect(assets.events).toContain(`purge:${DEMO_OWNER_ID}:${DEMO_SESSION_ID}`);
  });
  it('preserves files and surfaces a hard error when compensation cannot be proven', async () => {
    const repository = new MemoryRepository();
    repository.compensationError = new Error('Synthetic durable compensation failure');
    const assets = new FakeAssetStore();
    assets.prepareHandler = async () => Promise.reject(new Error('Synthetic asset failure'));
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    const failure = preparer.prepare({
      ownerId: DEMO_OWNER_ID,
      wireManifest: wireManifest(1),
    });
    await expect(failure).rejects.toBeInstanceOf(ExamOfflineError);
    await expect(failure).rejects.toMatchObject({ code: 'COMPENSATION_FAILED' });
    expect(assets.events.some((event) => event.startsWith('purge:'))).toBe(false);
  });
  it('deduplicates a concurrent preparation for the same owner and session', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const gate = deferred<string>();
    assets.prepareHandler = async () => gate.promise;
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    const input = { ownerId: DEMO_OWNER_ID, wireManifest: wireManifest(1) };
    const first = preparer.prepare(input);
    const second = preparer.prepare(input);
    expect(second).toBe(first);
    gate.resolve('asset:deduplicated');
    await first;
    expect(repository.events.filter((event) => event.startsWith('prepare-pack:'))).toHaveLength(1);
  });
  it('rejects an invalid manifest before any durable or asset boundary', async () => {
    const repository = new MemoryRepository();
    const assets = new FakeAssetStore();
    const preparer = new ExamPackPreparer(repository, assets, new ManualClock());
    await expect(
      preparer.prepare({
        ownerId: DEMO_OWNER_ID,
        wireManifest: { session_id: DEMO_SESSION_ID, assets: 'invalid' },
      }),
    ).rejects.toThrow('Pack assets');
    expect(repository.events).toEqual([]);
    expect(assets.events).toEqual([]);
  });
});
