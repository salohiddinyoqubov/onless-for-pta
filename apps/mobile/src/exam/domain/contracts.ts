export type CommandStatus = 'pending' | 'syncing' | 'conflict' | 'blocked';

interface DurableCommand {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly status: CommandStatus;
  readonly retryCount: number;
  readonly nextRetryAt: number;
  readonly lastErrorCode: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PositionCommand extends DurableCommand {
  readonly type: 'position';
  readonly positionCommandId: string;
  readonly questionId: string;
  readonly positionSeq: number;
}

export interface AnswerCommand extends DurableCommand {
  readonly type: 'answer';
  readonly clientAnswerId: string;
  readonly questionId: string;
  readonly answerId: string;
  readonly expectedRevision: number;
  readonly elapsedMs: number;
}

export type TerminalKind = 'complete' | 'abandon';

export interface TerminalCommand extends DurableCommand {
  readonly type: 'terminal';
  readonly clientTerminalId: string;
  readonly terminalKind: TerminalKind;
  readonly expectedRevision: number;
}

export type SyncCommand = PositionCommand | AnswerCommand | TerminalCommand;

export interface ConfirmAnswerInput {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly questionId: string;
  readonly answerId: string;
  readonly clientAnswerId: string;
  readonly elapsedMs: number;
  readonly now: number;
}

export interface PositionRequest {
  readonly position_command_id: string;
  readonly question_id: string;
  readonly position_seq: number;
}

export interface AnswerRequest {
  readonly client_answer_id: string;
  readonly question_id: string;
  readonly answer_id: string;
  readonly expected_revision: number;
  readonly elapsed_ms: number;
}

export interface TerminalRequest {
  readonly client_terminal_id: string;
  readonly expected_revision: number;
}

export type AckDisposition = 'accepted' | 'duplicate';

export interface PositionAck {
  readonly disposition: AckDisposition | 'stale';
  readonly sessionId: string;
  readonly commandId: string;
  readonly questionId: string;
  readonly positionSeq: number;
}

export interface AnswerAck {
  readonly disposition: AckDisposition;
  readonly sessionId: string;
  readonly commandId: string;
  readonly revision: number;
}

export interface TerminalAck {
  readonly disposition: AckDisposition;
  readonly sessionId: string;
  readonly commandId: string;
  readonly revision: number;
  readonly status: Exclude<SessionStatus, 'in_progress'>;
}

export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

export interface CanonicalSnapshot {
  readonly sessionId: string;
  readonly revision: number;
  readonly positionSeq: number;
  readonly status: SessionStatus;
}

export interface AssetDescriptor {
  readonly assetId: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

export interface AssetProjection extends AssetDescriptor {
  readonly state: 'pending' | 'ready' | 'corrupt';
  readonly storageKey: string | null;
}

export interface ExamPackManifest {
  readonly sessionId: string;
  readonly assets: readonly AssetDescriptor[];
}

export interface PackProgress {
  readonly completedAssets: number;
  readonly totalAssets: number;
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface SyncRunResult {
  readonly processedPositions: number;
  readonly processedAnswers: number;
  readonly processedTerminals: number;
  readonly stoppedByBudget: boolean;
  readonly cancelled: boolean;
  readonly offline: boolean;
}

export interface OfflineSweepReport {
  readonly abandonedPacks: number;
  readonly orphanTemporaryAssets: number;
  readonly reclaimedAssets: number;
  readonly reclaimedBytes: number;
  readonly failedStages: readonly (
    | 'garbage-collection'
    | 'stale-preparations'
    | 'temporary-assets'
  )[];
}

export interface AssetHealReport {
  readonly demoted: number;
  readonly repaired: number;
  readonly unrepaired: number;
}

export interface AssetGarbageCollection {
  readonly removed: number;
  readonly bytes: number;
}

export interface PreparePackInput {
  readonly ownerId: string;
  readonly wireManifest: unknown;
  readonly onProgress?: (progress: PackProgress) => void;
}

export type RetryableCommandStatus = Extract<CommandStatus, 'pending' | 'conflict' | 'blocked'>;

export interface RetryUpdate {
  readonly status: RetryableCommandStatus;
  readonly retryCount: number;
  readonly nextRetryAt: number;
  readonly errorCode: string;
  readonly updatedAt: number;
}
