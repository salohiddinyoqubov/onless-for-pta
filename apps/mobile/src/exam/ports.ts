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
} from './domain/contracts';

export interface Clock {
  now(): number;
  schedule(delayMs: number, task: () => void): () => void;
}

export interface RandomSource {
  next(): number;
}

export interface Connectivity {
  isOnline(signal: AbortSignal): Promise<boolean>;
}

export interface ExamTransportFailure {
  readonly status: number | null;
  readonly code?: string;
  readonly body?: unknown;
  readonly retryAfterHeader?: string | null;
}

export interface ExamSyncTransport {
  savePosition(
    sessionId: string,
    request: PositionRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
  sendAnswer(
    sessionId: string,
    request: AnswerRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
  sendTerminal(
    sessionId: string,
    terminalKind: TerminalKind,
    request: TerminalRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
  getSnapshot(sessionId: string, signal: AbortSignal): Promise<unknown>;
  normalizeFailure(error: unknown): ExamTransportFailure;
}

export interface AnswerWriteRepository {
  confirmAnswer(input: ConfirmAnswerInput): Promise<AnswerCommand>;
}

export interface SyncCommandStore extends AnswerWriteRepository {
  listDuePositionCommands(
    ownerId: string,
    now: number,
    limit: number,
    sessionId: string | null,
  ): Promise<readonly PositionCommand[]>;
  listDueAnswerCommands(
    ownerId: string,
    now: number,
    limit: number,
    sessionId: string | null,
  ): Promise<readonly AnswerCommand[]>;
  listDueTerminalCommands(
    ownerId: string,
    now: number,
    limit: number,
    sessionId: string | null,
  ): Promise<readonly TerminalCommand[]>;
  claimPositionForSync(commandId: string, now: number): Promise<PositionCommand | null>;
  claimAnswerForSync(commandId: string, now: number): Promise<AnswerCommand | null>;
  claimTerminalForSync(commandId: string, now: number): Promise<TerminalCommand | null>;
  acknowledgePosition(
    ownerId: string,
    command: PositionCommand,
    acknowledgement: PositionAck,
    now: number,
  ): Promise<void>;
  acknowledgeAnswer(
    ownerId: string,
    command: AnswerCommand,
    acknowledgement: AnswerAck,
    now: number,
  ): Promise<void>;
  acknowledgeTerminal(
    ownerId: string,
    command: TerminalCommand,
    acknowledgement: TerminalAck,
    now: number,
  ): Promise<void>;
  applySnapshot(ownerId: string, snapshot: CanonicalSnapshot, now: number): Promise<void>;
  schedulePositionRetry(commandId: string, update: RetryUpdate): Promise<void>;
  scheduleAnswerRetry(commandId: string, update: RetryUpdate): Promise<void>;
  scheduleTerminalRetry(commandId: string, update: RetryUpdate): Promise<void>;
  hasUnacknowledgedAnswers(ownerId: string, sessionId: string): Promise<boolean>;
  releaseInterruptedCommands(ownerId: string, now: number): Promise<void>;
}

export interface PackStore {
  preparePack(ownerId: string, manifest: ExamPackManifest, receivedAt: number): Promise<void>;
  markAssetReady(
    ownerId: string,
    sessionId: string,
    assetId: string,
    storageKey: string,
    now: number,
  ): Promise<void>;
  markAssetCorrupt(ownerId: string, sessionId: string, assetId: string, now: number): Promise<void>;
  markOfflineReady(ownerId: string, sessionId: string, now: number): Promise<void>;
  markPackPreparationFailed(
    ownerId: string,
    sessionId: string,
    reason: 'PACK_PREPARATION_CANCELLED' | 'PACK_PREPARATION_FAILED',
    now: number,
  ): Promise<void>;
  listReadyAssets(ownerId: string, sessionId: string): Promise<readonly AssetProjection[]>;
  listPendingAssets(ownerId: string, sessionId: string): Promise<readonly AssetProjection[]>;
}

export interface MaintenanceStore {
  listCleanupCandidates(ownerId: string, terminalBefore: number): Promise<readonly string[]>;
  deleteAttempts(ownerId: string, sessionIds: readonly string[]): Promise<void>;
  listStalePackPreparations(ownerId: string, startedBefore: number): Promise<readonly string[]>;
}

export interface ExamSyncRepository extends SyncCommandStore, PackStore, MaintenanceStore {}

export interface AssetStore {
  prepare(
    ownerId: string,
    sessionId: string,
    asset: AssetDescriptor,
    signal: AbortSignal,
  ): Promise<string>;
  isMaterialized(storageKey: string, expectedBytes: number): Promise<boolean>;
  purgeSession(ownerId: string, sessionId: string): Promise<void>;
  sweepTemporaryAssets(ownerId: string): Promise<number>;
  collectGarbage(ownerId: string, budgetBytes: number, now: number): Promise<AssetGarbageCollection>;
}

export interface BackgroundErrorContext {
  readonly operation: 'answer-sync' | 'release-interrupted-sync';
  readonly ownerId: string;
  readonly sessionId?: string;
}

export type ExamBackgroundErrorReporter = (
  error: unknown,
  context: BackgroundErrorContext,
) => void | Promise<void>;

export interface AnswerSyncWorker {
  run(ownerId: string, sessionId: string | null): Promise<unknown>;
}
