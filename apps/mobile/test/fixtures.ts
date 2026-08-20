import type {
  AnswerAck,
  AnswerCommand,
  AnswerRequest,
  AssetDescriptor,
  AssetGarbageCollection,
  AssetProjection,
  CanonicalSnapshot,
  ConfirmAnswerInput,
  ExamPackManifest,
  PositionAck,
  PositionCommand,
  PositionRequest,
  RetryUpdate,
  TerminalAck,
  TerminalCommand,
  TerminalKind,
  TerminalRequest,
} from '../src/exam/domain/contracts';
import type {
  AssetStore,
  Clock,
  Connectivity,
  ExamSyncRepository,
  ExamSyncTransport,
  ExamTransportFailure,
  RandomSource,
} from '../src/exam/ports';
export const DEMO_OWNER_ID = '00000000-0000-4000-8000-000000000001';
export const SECOND_OWNER_ID = '00000000-0000-4000-8000-000000000002';
export const DEMO_SESSION_ID = '10000000-0000-4000-8000-000000000001';
export const SECOND_SESSION_ID = '10000000-0000-4000-8000-000000000002';
export const DEMO_QUESTION_ID = '20000000-0000-4000-8000-000000000001';
export const DEMO_ANSWER_ID = '30000000-0000-4000-8000-000000000001';
export const DEMO_POSITION_COMMAND_ID = '40000000-0000-4000-8000-000000000001';
export const DEMO_ANSWER_COMMAND_ID = '50000000-0000-4000-8000-000000000001';
export const DEMO_TERMINAL_COMMAND_ID = '60000000-0000-4000-8000-000000000001';
export class ManualClock implements Clock {
  private nextTimerId = 0;
  private readonly timers = new Map<number, { readonly dueAt: number; readonly task: () => void }>();
  public constructor(private currentTime = 10_000) {}
  public now(): number {
    return this.currentTime;
  }
  public schedule(delayMs: number, task: () => void): () => void {
    const timerId = ++this.nextTimerId;
    this.timers.set(timerId, { dueAt: this.currentTime + delayMs, task });
    return () => this.timers.delete(timerId);
  }
  public advance(milliseconds: number): void {
    this.currentTime += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.dueAt <= this.currentTime)
      .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0]);
    for (const [timerId, timer] of due) {
      if (!this.timers.delete(timerId)) continue;
      timer.task();
    }
  }
  public pendingTimers(): number {
    return this.timers.size;
  }
}
export class FixedRandom implements RandomSource {
  public constructor(public value = 0.5) {}
  public next(): number {
    return this.value;
  }
}
export class MutableConnectivity implements Connectivity {
  public constructor(public online = true) {}
  public async isOnline(signal: AbortSignal): Promise<boolean> {
    return signal.aborted ? false : this.online;
  }
}
export function positionCommand(
  overrides: Partial<PositionCommand> = {},
): PositionCommand {
  return {
    type: 'position',
    ownerId: DEMO_OWNER_ID,
    sessionId: DEMO_SESSION_ID,
    positionCommandId: DEMO_POSITION_COMMAND_ID,
    questionId: DEMO_QUESTION_ID,
    positionSeq: 1,
    status: 'pending',
    retryCount: 0,
    nextRetryAt: 10_000,
    lastErrorCode: null,
    createdAt: 9_000,
    updatedAt: 9_000,
    ...overrides,
  };
}
export function answerCommand(overrides: Partial<AnswerCommand> = {}): AnswerCommand {
  return {
    type: 'answer',
    ownerId: DEMO_OWNER_ID,
    sessionId: DEMO_SESSION_ID,
    clientAnswerId: DEMO_ANSWER_COMMAND_ID,
    questionId: DEMO_QUESTION_ID,
    answerId: DEMO_ANSWER_ID,
    expectedRevision: 0,
    elapsedMs: 750,
    status: 'pending',
    retryCount: 0,
    nextRetryAt: 10_000,
    lastErrorCode: null,
    createdAt: 9_000,
    updatedAt: 9_000,
    ...overrides,
  };
}
export function terminalCommand(
  overrides: Partial<TerminalCommand> = {},
): TerminalCommand {
  return {
    type: 'terminal',
    ownerId: DEMO_OWNER_ID,
    sessionId: DEMO_SESSION_ID,
    clientTerminalId: DEMO_TERMINAL_COMMAND_ID,
    terminalKind: 'complete',
    expectedRevision: 1,
    status: 'pending',
    retryCount: 0,
    nextRetryAt: 10_000,
    lastErrorCode: null,
    createdAt: 9_000,
    updatedAt: 9_000,
    ...overrides,
  };
}
export function assetDescriptor(index = 1): AssetDescriptor {
  const suffix = index.toString(16).padStart(12, '0');
  return {
    assetId: `70000000-0000-4000-8000-${suffix}`,
    digest: index.toString(16).padStart(64, '0'),
    sizeBytes: index * 100,
    mimeType: 'image/webp',
  };
}
export function assetProjection(
  index = 1,
  overrides: Partial<AssetProjection> = {},
): AssetProjection {
  return {
    ...assetDescriptor(index),
    state: 'pending',
    storageKey: null,
    ...overrides,
  };
}
export function wireManifest(count = 3): unknown {
  return {
    session_id: DEMO_SESSION_ID,
    assets: Array.from({ length: count }, (_, offset) => {
      const asset = assetDescriptor(offset + 1);
      return {
        asset_id: asset.assetId,
        sha256: asset.digest,
        size_bytes: asset.sizeBytes,
        mime_type: asset.mimeType,
      };
    }),
  };
}
export class SyntheticTransportError extends Error {
  public constructor(public readonly failure: ExamTransportFailure) {
    super(failure.code ?? 'Synthetic transport failure');
  }
}
export function transportError(failure: ExamTransportFailure): SyntheticTransportError {
  return new SyntheticTransportError(failure);
}
type PositionHandler = (
  sessionId: string,
  request: PositionRequest,
  signal: AbortSignal,
) => Promise<unknown>;
type AnswerHandler = (
  sessionId: string,
  request: AnswerRequest,
  signal: AbortSignal,
) => Promise<unknown>;
type TerminalHandler = (
  sessionId: string,
  terminalKind: TerminalKind,
  request: TerminalRequest,
  signal: AbortSignal,
) => Promise<unknown>;
type SnapshotHandler = (sessionId: string, signal: AbortSignal) => Promise<unknown>;
export class FakeTransport implements ExamSyncTransport {
  public readonly events: string[] = [];
  public readonly positionRequests: PositionRequest[] = [];
  public readonly answerRequests: AnswerRequest[] = [];
  public readonly terminalRequests: TerminalRequest[] = [];
  public readonly snapshotSessions: string[] = [];
  public positionHandler: PositionHandler = async (sessionId, request) => ({
    disposition: 'accepted',
    session_id: sessionId,
    position_command_id: request.position_command_id,
    question_id: request.question_id,
    position_seq: request.position_seq,
  });
  public answerHandler: AnswerHandler = async (sessionId, request) => ({
    disposition: 'accepted',
    session_id: sessionId,
    client_answer_id: request.client_answer_id,
    revision: request.expected_revision + 1,
  });
  public terminalHandler: TerminalHandler = async (sessionId, terminalKind, request) => ({
    disposition: 'accepted',
    session_id: sessionId,
    client_terminal_id: request.client_terminal_id,
    revision: request.expected_revision,
    status: terminalKind === 'complete' ? 'completed' : 'abandoned',
  });
  public snapshotHandler: SnapshotHandler = async (sessionId) => ({
    session_id: sessionId,
    revision: 1,
    position_seq: 1,
    status: 'in_progress',
  });
  public async savePosition(
    sessionId: string,
    request: PositionRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.events.push(`position:${sessionId}`);
    this.positionRequests.push(request);
    return this.positionHandler(sessionId, request, signal);
  }
  public async sendAnswer(
    sessionId: string,
    request: AnswerRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.events.push(`answer:${sessionId}`);
    this.answerRequests.push(request);
    return this.answerHandler(sessionId, request, signal);
  }
  public async sendTerminal(
    sessionId: string,
    terminalKind: TerminalKind,
    request: TerminalRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.events.push(`terminal:${sessionId}`);
    this.terminalRequests.push(request);
    return this.terminalHandler(sessionId, terminalKind, request, signal);
  }
  public async getSnapshot(sessionId: string, signal: AbortSignal): Promise<unknown> {
    this.events.push(`snapshot:${sessionId}`);
    this.snapshotSessions.push(sessionId);
    return this.snapshotHandler(sessionId, signal);
  }
  public normalizeFailure(error: unknown): ExamTransportFailure {
    return error instanceof SyntheticTransportError
      ? error.failure
      : { status: null, code: 'NETWORK_UNKNOWN' };
  }
}
export class MemoryRepository implements ExamSyncRepository {
  public positions: PositionCommand[] = [];
  public answers: AnswerCommand[] = [];
  public terminals: TerminalCommand[] = [];
  public readyAssets: AssetProjection[] = [];
  public pendingAssets: AssetProjection[] = [];
  public cleanupCandidates: string[] = [];
  public stalePreparations: string[] = [];
  public readonly events: string[] = [];
  public readonly snapshots: CanonicalSnapshot[] = [];
  public readonly positionAcks: PositionAck[] = [];
  public readonly answerAcks: AnswerAck[] = [];
  public readonly terminalAcks: TerminalAck[] = [];
  public readonly positionRetries: RetryUpdate[] = [];
  public readonly answerRetries: RetryUpdate[] = [];
  public readonly terminalRetries: RetryUpdate[] = [];
  public releaseError: Error | null = null;
  public compensationError: Error | null = null;
  public async confirmAnswer(input: ConfirmAnswerInput): Promise<AnswerCommand> {
    const command = answerCommand({
      ownerId: input.ownerId,
      sessionId: input.sessionId,
      questionId: input.questionId,
      answerId: input.answerId,
      clientAnswerId: input.clientAnswerId,
      elapsedMs: input.elapsedMs,
      createdAt: input.now,
      updatedAt: input.now,
      nextRetryAt: input.now,
    });
    this.events.push('persist-answer');
    this.answers.push(command);
    return command;
  }
  public async listDuePositionCommands(
    ownerId: string,
    now: number,
    limit: number,
    sessionId: string | null,
  ): Promise<readonly PositionCommand[]> {
    return this.due(this.positions, ownerId, now, limit, sessionId);
  }
  public async listDueAnswerCommands(
    ownerId: string,
    now: number,
    limit: number,
    sessionId: string | null,
  ): Promise<readonly AnswerCommand[]> {
    return this.due(this.answers, ownerId, now, limit, sessionId);
  }
  public async listDueTerminalCommands(
    ownerId: string,
    now: number,
    limit: number,
    sessionId: string | null,
  ): Promise<readonly TerminalCommand[]> {
    return this.due(this.terminals, ownerId, now, limit, sessionId);
  }
  public async claimPositionForSync(commandId: string, now: number): Promise<PositionCommand | null> {
    const command = this.positions.find(({ positionCommandId }) => positionCommandId === commandId);
    return command ? { ...command, status: 'syncing', updatedAt: now } : null;
  }
  public async claimAnswerForSync(commandId: string, now: number): Promise<AnswerCommand | null> {
    const command = this.answers.find(({ clientAnswerId }) => clientAnswerId === commandId);
    return command ? { ...command, status: 'syncing', updatedAt: now } : null;
  }
  public async claimTerminalForSync(commandId: string, now: number): Promise<TerminalCommand | null> {
    const command = this.terminals.find(({ clientTerminalId }) => clientTerminalId === commandId);
    return command ? { ...command, status: 'syncing', updatedAt: now } : null;
  }
  public async acknowledgePosition(
    _ownerId: string,
    command: PositionCommand,
    acknowledgement: PositionAck,
    _now: number,
  ): Promise<void> {
    void _now;
    this.events.push(`ack-position:${command.positionCommandId}`);
    this.positionAcks.push(acknowledgement);
    this.positions = this.positions.filter(
      ({ positionCommandId }) => positionCommandId !== command.positionCommandId,
    );
  }
  public async acknowledgeAnswer(
    _ownerId: string,
    command: AnswerCommand,
    acknowledgement: AnswerAck,
    _now: number,
  ): Promise<void> {
    void _now;
    this.events.push(`ack-answer:${command.clientAnswerId}`);
    this.answerAcks.push(acknowledgement);
    this.answers = this.answers.filter(({ clientAnswerId }) => clientAnswerId !== command.clientAnswerId);
  }
  public async acknowledgeTerminal(
    _ownerId: string,
    command: TerminalCommand,
    acknowledgement: TerminalAck,
    _now: number,
  ): Promise<void> {
    void _now;
    this.events.push(`ack-terminal:${command.clientTerminalId}`);
    this.terminalAcks.push(acknowledgement);
    this.terminals = this.terminals.filter(
      ({ clientTerminalId }) => clientTerminalId !== command.clientTerminalId,
    );
  }
  public async applySnapshot(
    _ownerId: string,
    snapshot: CanonicalSnapshot,
    _now: number,
  ): Promise<void> {
    void _now;
    this.events.push(`snapshot:${snapshot.sessionId}`);
    this.snapshots.push(snapshot);
  }
  public async schedulePositionRetry(commandId: string, update: RetryUpdate): Promise<void> {
    this.positionRetries.push(update);
    this.positions = this.positions.map((command) =>
      command.positionCommandId === commandId
        ? { ...command, ...this.retryFields(update) }
        : command,
    );
  }
  public async scheduleAnswerRetry(commandId: string, update: RetryUpdate): Promise<void> {
    this.answerRetries.push(update);
    this.answers = this.answers.map((command) =>
      command.clientAnswerId === commandId ? { ...command, ...this.retryFields(update) } : command,
    );
  }
  public async scheduleTerminalRetry(commandId: string, update: RetryUpdate): Promise<void> {
    this.terminalRetries.push(update);
    this.terminals = this.terminals.map((command) =>
      command.clientTerminalId === commandId
        ? { ...command, ...this.retryFields(update) }
        : command,
    );
  }
  public async hasUnacknowledgedAnswers(ownerId: string, sessionId: string): Promise<boolean> {
    return this.answers.some(
      (command) => command.ownerId === ownerId && command.sessionId === sessionId,
    );
  }
  public async releaseInterruptedCommands(ownerId: string, _now: number): Promise<void> {
    void _now;
    this.events.push(`release:${ownerId}`);
    if (this.releaseError) throw this.releaseError;
  }
  public async preparePack(
    ownerId: string,
    manifest: ExamPackManifest,
    _receivedAt: number,
  ): Promise<void> {
    void _receivedAt;
    this.events.push(`prepare-pack:${ownerId}:${manifest.sessionId}`);
    this.pendingAssets = manifest.assets.map((asset) => ({
      ...asset,
      state: 'pending',
      storageKey: null,
    }));
  }
  public async markAssetReady(
    _ownerId: string,
    _sessionId: string,
    assetId: string,
    storageKey: string,
    _now: number,
  ): Promise<void> {
    void _now;
    const asset = this.pendingAssets.find((candidate) => candidate.assetId === assetId);
    if (asset) {
      this.pendingAssets = this.pendingAssets.filter((candidate) => candidate.assetId !== assetId);
      this.readyAssets.push({ ...asset, state: 'ready', storageKey });
    }
    this.events.push(`asset-ready:${assetId}`);
  }
  public async markAssetCorrupt(
    _ownerId: string,
    _sessionId: string,
    assetId: string,
    _now: number,
  ): Promise<void> {
    void _now;
    const ready = this.readyAssets.find((candidate) => candidate.assetId === assetId);
    if (ready) {
      this.readyAssets = this.readyAssets.filter((candidate) => candidate.assetId !== assetId);
      this.pendingAssets.push({ ...ready, state: 'corrupt', storageKey: null });
    }
    this.events.push(`asset-corrupt:${assetId}`);
  }
  public async markOfflineReady(ownerId: string, sessionId: string, _now: number): Promise<void> {
    void _now;
    this.events.push(`offline-ready:${ownerId}:${sessionId}`);
  }
  public async markPackPreparationFailed(
    ownerId: string,
    sessionId: string,
    reason: 'PACK_PREPARATION_CANCELLED' | 'PACK_PREPARATION_FAILED',
    _now: number,
  ): Promise<void> {
    void _now;
    this.events.push(`pack-failed:${ownerId}:${sessionId}:${reason}`);
    if (this.compensationError) throw this.compensationError;
  }
  public async listReadyAssets(
    _ownerId: string,
    _sessionId: string,
  ): Promise<readonly AssetProjection[]> {
    void _ownerId;
    void _sessionId;
    return this.readyAssets;
  }
  public async listPendingAssets(
    _ownerId: string,
    _sessionId: string,
  ): Promise<readonly AssetProjection[]> {
    void _ownerId;
    void _sessionId;
    return this.pendingAssets;
  }
  public async listCleanupCandidates(
    _ownerId: string,
    _terminalBefore: number,
  ): Promise<readonly string[]> {
    void _ownerId;
    void _terminalBefore;
    return this.cleanupCandidates;
  }
  public async deleteAttempts(ownerId: string, sessionIds: readonly string[]): Promise<void> {
    this.events.push(`delete-attempts:${ownerId}:${sessionIds.join(',')}`);
  }
  public async listStalePackPreparations(
    _ownerId: string,
    _startedBefore: number,
  ): Promise<readonly string[]> {
    void _ownerId;
    void _startedBefore;
    return this.stalePreparations;
  }
  private due<T extends PositionCommand | AnswerCommand | TerminalCommand>(
    commands: readonly T[],
    ownerId: string,
    now: number,
    limit: number,
    sessionId: string | null,
  ): readonly T[] {
    return commands
      .filter(
        (command) =>
          command.ownerId === ownerId &&
          (sessionId === null || command.sessionId === sessionId) &&
          command.status !== 'blocked' &&
          command.status !== 'syncing' &&
          command.nextRetryAt <= now,
      )
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, limit);
  }
  private retryFields(update: RetryUpdate): Pick<
    AnswerCommand,
    'status' | 'retryCount' | 'nextRetryAt' | 'lastErrorCode' | 'updatedAt'
  > {
    return {
      status: update.status,
      retryCount: update.retryCount,
      nextRetryAt: update.nextRetryAt,
      lastErrorCode: update.errorCode,
      updatedAt: update.updatedAt,
    };
  }
}
type PrepareHandler = (
  ownerId: string,
  sessionId: string,
  asset: AssetDescriptor,
  signal: AbortSignal,
) => Promise<string>;
export class FakeAssetStore implements AssetStore {
  public readonly events: string[] = [];
  public readonly materialized = new Map<string, number>();
  public activePreparations = 0;
  public maximumActivePreparations = 0;
  public temporaryAssets = 0;
  public garbage: AssetGarbageCollection = { removed: 0, bytes: 0 };
  public temporaryError: Error | null = null;
  public garbageError: Error | null = null;
  public purgeError: Error | null = null;
  public prepareHandler: PrepareHandler = async (_ownerId, _sessionId, asset, signal) => {
    if (signal.aborted) throw new Error('Preparation aborted');
    return `asset:${asset.assetId}`;
  };
  public async prepare(
    ownerId: string,
    sessionId: string,
    asset: AssetDescriptor,
    signal: AbortSignal,
  ): Promise<string> {
    this.activePreparations += 1;
    this.maximumActivePreparations = Math.max(
      this.maximumActivePreparations,
      this.activePreparations,
    );
    this.events.push(`prepare:${asset.assetId}`);
    try {
      const storageKey = await this.prepareHandler(ownerId, sessionId, asset, signal);
      this.materialized.set(storageKey, asset.sizeBytes);
      return storageKey;
    } finally {
      this.activePreparations -= 1;
    }
  }
  public async isMaterialized(storageKey: string, expectedBytes: number): Promise<boolean> {
    return this.materialized.get(storageKey) === expectedBytes;
  }
  public async purgeSession(ownerId: string, sessionId: string): Promise<void> {
    this.events.push(`purge:${ownerId}:${sessionId}`);
    if (this.purgeError) throw this.purgeError;
  }
  public async sweepTemporaryAssets(ownerId: string): Promise<number> {
    this.events.push(`sweep-temporary:${ownerId}`);
    if (this.temporaryError) throw this.temporaryError;
    return this.temporaryAssets;
  }
  public async collectGarbage(
    ownerId: string,
    _budgetBytes: number,
    _now: number,
  ): Promise<AssetGarbageCollection> {
    void _budgetBytes;
    void _now;
    this.events.push(`collect-garbage:${ownerId}`);
    if (this.garbageError) throw this.garbageError;
    return this.garbage;
  }
}
export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (!resolvePromise || !rejectPromise) throw new Error('Deferred promise was not initialized.');
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
