import type {
  AssetDescriptor,
  ExamPackManifest,
  PackProgress,
  PreparePackInput,
} from '../domain/contracts';
import { decodePackManifest } from '../domain/decoders';
import { ExamOfflineError } from '../domain/errors';
import type { AssetStore, Clock, PackStore } from '../ports';

export const EXAM_PACK_ASSET_CONCURRENCY = 4;

type PackAssetStore = Pick<AssetStore, 'prepare' | 'purgeSession'>;

interface AssetFailure {
  readonly assetId: string;
  readonly error: unknown;
}

interface ActivePackRun {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

export class ExamPackPreparer {
  private readonly activeRuns = new Map<string, ActivePackRun>();
  private readonly ownerGenerations = new Map<string, number>();
  private readonly sessionGenerations = new Map<string, number>();
  private readonly cancelledOwners = new Set<string>();

  public constructor(
    private readonly repository: Pick<
      PackStore,
      | 'preparePack'
      | 'markAssetReady'
      | 'markAssetCorrupt'
      | 'markOfflineReady'
      | 'markPackPreparationFailed'
    >,
    private readonly assets: PackAssetStore,
    private readonly clock: Clock,
  ) {}

  public prepare(input: PreparePackInput): Promise<void> {
    if (this.cancelledOwners.has(input.ownerId)) {
      return Promise.reject(
        new ExamOfflineError('OWNER_INACTIVE', 'Owner is not active for pack preparation.'),
      );
    }
    let manifest: ExamPackManifest;
    try {
      manifest = decodePackManifest(input.wireManifest);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error('Pack manifest validation failed.'),
      );
    }
    const scope = this.scopeKey(input.ownerId, manifest.sessionId);
    const active = this.activeRuns.get(scope);
    if (active) return active.promise;

    const ownerGeneration = this.ownerGenerations.get(input.ownerId) ?? 0;
    const sessionGeneration = this.sessionGenerations.get(scope) ?? 0;
    const controller = new AbortController();
    const promise = this.runPrepare(
      input,
      manifest,
      ownerGeneration,
      sessionGeneration,
      controller.signal,
    ).finally(() => {
      if (this.activeRuns.get(scope)?.promise === promise) this.activeRuns.delete(scope);
    });
    this.activeRuns.set(scope, {
      ownerId: input.ownerId,
      sessionId: manifest.sessionId,
      controller,
      promise,
    });
    return promise;
  }

  public async cancelOwner(ownerId: string): Promise<void> {
    this.cancelledOwners.add(ownerId);
    this.ownerGenerations.set(ownerId, (this.ownerGenerations.get(ownerId) ?? 0) + 1);
    const interrupted = [...this.activeRuns.entries()].filter(
      ([, run]) => run.ownerId === ownerId,
    );
    for (const [scope, run] of interrupted) {
      run.controller.abort();
      this.activeRuns.delete(scope);
    }
    await Promise.allSettled(interrupted.map(([, run]) => run.promise));
  }

  public activateOwner(ownerId: string): void {
    this.cancelledOwners.delete(ownerId);
  }

  public async cancelSession(ownerId: string, sessionId: string): Promise<void> {
    const scope = this.scopeKey(ownerId, sessionId);
    this.sessionGenerations.set(scope, (this.sessionGenerations.get(scope) ?? 0) + 1);
    const active = this.activeRuns.get(scope);
    if (!active) return;
    active.controller.abort();
    this.activeRuns.delete(scope);
    await Promise.allSettled([active.promise]);
  }

  private async runPrepare(
    input: PreparePackInput,
    manifest: ExamPackManifest,
    ownerGeneration: number,
    sessionGeneration: number,
    signal: AbortSignal,
  ): Promise<void> {
    const totalAssets = manifest.assets.length;
    const totalBytes = manifest.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
    let completedAssets = 0;
    let completedBytes = 0;
    let packPersisted = false;
    let failedAssetId: string | null = null;
    try {
      this.assertCurrent(
        input.ownerId,
        manifest.sessionId,
        ownerGeneration,
        sessionGeneration,
        signal,
      );
      this.reportProgress(input.onProgress, completedAssets, totalAssets, completedBytes, totalBytes);
      await this.repository.preparePack(input.ownerId, manifest, this.clock.now());
      packPersisted = true;
      this.assertCurrent(
        input.ownerId,
        manifest.sessionId,
        ownerGeneration,
        sessionGeneration,
        signal,
      );
      const failure = await this.prepareAssets(
        input,
        manifest,
        ownerGeneration,
        sessionGeneration,
        signal,
        (asset) => {
          completedAssets += 1;
          completedBytes += asset.sizeBytes;
          this.reportProgress(
            input.onProgress,
            completedAssets,
            totalAssets,
            completedBytes,
            totalBytes,
          );
        },
      );
      if (failure) {
        failedAssetId = failure.assetId;
        throw failure.error;
      }
      await this.repository.markOfflineReady(input.ownerId, manifest.sessionId, this.clock.now());
      this.assertCurrent(
        input.ownerId,
        manifest.sessionId,
        ownerGeneration,
        sessionGeneration,
        signal,
      );
    } catch (error) {
      if (packPersisted) {
        await this.compensate(input.ownerId, manifest.sessionId, failedAssetId, signal, error);
      }
      throw error;
    }
  }

  private async prepareAssets(
    input: PreparePackInput,
    manifest: ExamPackManifest,
    ownerGeneration: number,
    sessionGeneration: number,
    signal: AbortSignal,
    onReady: (asset: AssetDescriptor) => void,
  ): Promise<AssetFailure | null> {
    const pool = new AbortController();
    const abortPool = (): void => pool.abort();
    if (signal.aborted) abortPool();
    else signal.addEventListener('abort', abortPool, { once: true });
    let nextIndex = 0;
    let failure: AssetFailure | null = null;

    const worker = async (): Promise<void> => {
      while (failure === null) {
        const index = nextIndex;
        nextIndex += 1;
        const asset = manifest.assets[index];
        if (!asset) return;
        try {
          const storageKey = await this.assets.prepare(
            input.ownerId,
            manifest.sessionId,
            asset,
            pool.signal,
          );
          this.assertCurrent(
            input.ownerId,
            manifest.sessionId,
            ownerGeneration,
            sessionGeneration,
            signal,
          );
          await this.repository.markAssetReady(
            input.ownerId,
            manifest.sessionId,
            asset.assetId,
            storageKey,
            this.clock.now(),
          );
          onReady(asset);
          this.assertCurrent(
            input.ownerId,
            manifest.sessionId,
            ownerGeneration,
            sessionGeneration,
            signal,
          );
        } catch (error) {
          failure ??= { assetId: asset.assetId, error };
          abortPool();
          return;
        }
      }
    };

    try {
      const workers = Math.min(EXAM_PACK_ASSET_CONCURRENCY, manifest.assets.length);
      await Promise.all(Array.from({ length: workers }, worker));
    } finally {
      signal.removeEventListener('abort', abortPool);
    }
    return failure;
  }

  private async compensate(
    ownerId: string,
    sessionId: string,
    failedAssetId: string | null,
    signal: AbortSignal,
    originalError: unknown,
  ): Promise<void> {
    try {
      await this.repository.markPackPreparationFailed(
        ownerId,
        sessionId,
        signal.aborted ? 'PACK_PREPARATION_CANCELLED' : 'PACK_PREPARATION_FAILED',
        this.clock.now(),
      );
      if (failedAssetId) {
        await this.repository.markAssetCorrupt(
          ownerId,
          sessionId,
          failedAssetId,
          this.clock.now(),
        );
      }
      await this.assets.purgeSession(ownerId, sessionId);
    } catch (compensationError) {
      throw new ExamOfflineError(
        'COMPENSATION_FAILED',
        'Pack preparation could not be compensated; verified assets were preserved.',
        { originalError, compensationError },
      );
    }
  }

  private assertCurrent(
    ownerId: string,
    sessionId: string,
    ownerGeneration: number,
    sessionGeneration: number,
    signal: AbortSignal,
  ): void {
    const scope = this.scopeKey(ownerId, sessionId);
    if (
      signal.aborted ||
      (this.ownerGenerations.get(ownerId) ?? 0) !== ownerGeneration ||
      (this.sessionGenerations.get(scope) ?? 0) !== sessionGeneration
    ) {
      throw new ExamOfflineError(
        'PREPARATION_CANCELLED',
        'Pack preparation was cancelled before it crossed a durable boundary.',
      );
    }
  }

  private reportProgress(
    listener: ((progress: PackProgress) => void) | undefined,
    completedAssets: number,
    totalAssets: number,
    completedBytes: number,
    totalBytes: number,
  ): void {
    listener?.({ completedAssets, totalAssets, completedBytes, totalBytes });
  }

  private scopeKey(ownerId: string, sessionId: string): string {
    return `${ownerId}:${sessionId}`;
  }
}
