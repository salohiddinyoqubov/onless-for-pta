import type {
  AnswerAck,
  AnswerCommand,
  CanonicalSnapshot,
  PositionAck,
  PositionCommand,
  RetryUpdate,
  SyncCommand,
  TerminalAck,
  TerminalCommand,
} from '../domain/contracts';
import {
  decodeAnswerAck,
  decodePositionAck,
  decodeSnapshot,
  decodeTerminalAck,
} from '../domain/decoders';
import { ExamContractError } from '../domain/errors';
import type {
  Clock,
  ExamSyncTransport,
  ExamTransportFailure,
  RandomSource,
  SyncCommandStore,
} from '../ports';
import {
  classifyRetry,
  DEFAULT_RETRY_POLICY,
  fullJitterDelay,
  type RetryPolicy,
} from './backoff';

export interface RequestLease {
  readonly signal: AbortSignal;
  release(): void;
}

export type RequestLeaseFactory = () => RequestLease;

export interface ProcessorResult {
  readonly attempted: boolean;
  readonly progressed: boolean;
}

interface ProcessorDependencies {
  readonly ownerId: string;
  readonly repository: SyncCommandStore;
  readonly transport: ExamSyncTransport;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly requestLease: RequestLeaseFactory;
  readonly isCurrent: () => boolean;
  readonly retryPolicy?: RetryPolicy;
}

const NOT_ATTEMPTED: ProcessorResult = { attempted: false, progressed: false };
const RETRIED: ProcessorResult = { attempted: true, progressed: false };
const APPLIED: ProcessorResult = { attempted: true, progressed: true };

export class CommandProcessors {
  private readonly retryPolicy: RetryPolicy;

  public constructor(private readonly dependencies: ProcessorDependencies) {
    this.retryPolicy = dependencies.retryPolicy ?? DEFAULT_RETRY_POLICY;
  }

  public async position(initial: PositionCommand): Promise<ProcessorResult> {
    if (initial.status === 'conflict') return this.reconcilePosition(initial);
    const command = await this.dependencies.repository.claimPositionForSync(
      initial.positionCommandId,
      this.dependencies.clock.now(),
    );
    if (!command || !this.dependencies.isCurrent()) return NOT_ATTEMPTED;
    const lease = this.dependencies.requestLease();
    try {
      const acknowledgement = decodePositionAck(
        await this.dependencies.transport.savePosition(
          command.sessionId,
          {
            position_command_id: command.positionCommandId,
            question_id: command.questionId,
            position_seq: command.positionSeq,
          },
          lease.signal,
        ),
      );
      if (!this.dependencies.isCurrent()) return RETRIED;
      this.assertPositionAck(command, acknowledgement);
      await this.dependencies.repository.acknowledgePosition(
        this.dependencies.ownerId,
        command,
        acknowledgement,
        this.dependencies.clock.now(),
      );
      return APPLIED;
    } catch (error) {
      if (!this.dependencies.isCurrent()) return RETRIED;
      const failure = this.normalizeFailure(error);
      const update = this.retry(command.retryCount, failure);
      await this.dependencies.repository.schedulePositionRetry(
        command.positionCommandId,
        update,
      );
      return update.status === 'conflict'
        ? this.reconcilePosition({ ...command, ...this.retryFields(update) })
        : RETRIED;
    } finally {
      lease.release();
    }
  }

  public async answer(initial: AnswerCommand): Promise<ProcessorResult> {
    if (initial.status === 'conflict') return this.reconcileAnswer(initial);
    const command = await this.dependencies.repository.claimAnswerForSync(
      initial.clientAnswerId,
      this.dependencies.clock.now(),
    );
    if (!command || !this.dependencies.isCurrent()) return NOT_ATTEMPTED;
    const lease = this.dependencies.requestLease();
    try {
      const acknowledgement = decodeAnswerAck(
        await this.dependencies.transport.sendAnswer(
          command.sessionId,
          {
            client_answer_id: command.clientAnswerId,
            question_id: command.questionId,
            answer_id: command.answerId,
            expected_revision: command.expectedRevision,
            elapsed_ms: command.elapsedMs,
          },
          lease.signal,
        ),
      );
      if (!this.dependencies.isCurrent()) return RETRIED;
      this.assertAnswerAck(command, acknowledgement);
      await this.dependencies.repository.acknowledgeAnswer(
        this.dependencies.ownerId,
        command,
        acknowledgement,
        this.dependencies.clock.now(),
      );
      return APPLIED;
    } catch (error) {
      if (!this.dependencies.isCurrent()) return RETRIED;
      const failure = this.normalizeFailure(error);
      const update = this.retry(command.retryCount, failure);
      await this.dependencies.repository.scheduleAnswerRetry(command.clientAnswerId, update);
      return update.status === 'conflict'
        ? this.reconcileAnswer({ ...command, ...this.retryFields(update) })
        : RETRIED;
    } finally {
      lease.release();
    }
  }

  public async terminal(initial: TerminalCommand): Promise<ProcessorResult> {
    if (initial.status === 'conflict') return this.reconcileTerminal(initial);
    const command = await this.dependencies.repository.claimTerminalForSync(
      initial.clientTerminalId,
      this.dependencies.clock.now(),
    );
    if (!command || !this.dependencies.isCurrent()) return NOT_ATTEMPTED;
    const lease = this.dependencies.requestLease();
    try {
      const acknowledgement = decodeTerminalAck(
        await this.dependencies.transport.sendTerminal(
          command.sessionId,
          command.terminalKind,
          {
            client_terminal_id: command.clientTerminalId,
            expected_revision: command.expectedRevision,
          },
          lease.signal,
        ),
      );
      if (!this.dependencies.isCurrent()) return RETRIED;
      this.assertTerminalAck(command, acknowledgement);
      await this.dependencies.repository.acknowledgeTerminal(
        this.dependencies.ownerId,
        command,
        acknowledgement,
        this.dependencies.clock.now(),
      );
      return APPLIED;
    } catch (error) {
      if (!this.dependencies.isCurrent()) return RETRIED;
      const failure = this.normalizeFailure(error);
      const update = this.retry(command.retryCount, failure);
      await this.dependencies.repository.scheduleTerminalRetry(command.clientTerminalId, update);
      return update.status === 'conflict'
        ? this.reconcileTerminal({ ...command, ...this.retryFields(update) })
        : RETRIED;
    } finally {
      lease.release();
    }
  }

  private async reconcilePosition(command: PositionCommand): Promise<ProcessorResult> {
    const snapshot = await this.fetchSnapshot(command);
    if (!snapshot) return RETRIED;
    if (snapshot.positionSeq < command.positionSeq && snapshot.status === 'in_progress') {
      await this.scheduleCanonicalRetry(command, 'CANONICAL_POSITION_BEHIND');
      return RETRIED;
    }
    const acknowledgement: PositionAck = {
      disposition: 'duplicate',
      sessionId: command.sessionId,
      commandId: command.positionCommandId,
      questionId: command.questionId,
      positionSeq: command.positionSeq,
    };
    await this.dependencies.repository.acknowledgePosition(
      this.dependencies.ownerId,
      command,
      acknowledgement,
      this.dependencies.clock.now(),
    );
    return APPLIED;
  }

  private async reconcileAnswer(command: AnswerCommand): Promise<ProcessorResult> {
    const snapshot = await this.fetchSnapshot(command);
    if (!snapshot) return RETRIED;
    if (snapshot.revision <= command.expectedRevision) {
      await this.scheduleCanonicalRetry(command, 'CANONICAL_REVISION_BEHIND');
      return RETRIED;
    }
    const acknowledgement: AnswerAck = {
      disposition: 'duplicate',
      sessionId: command.sessionId,
      commandId: command.clientAnswerId,
      revision: snapshot.revision,
    };
    await this.dependencies.repository.acknowledgeAnswer(
      this.dependencies.ownerId,
      command,
      acknowledgement,
      this.dependencies.clock.now(),
    );
    return APPLIED;
  }

  private async reconcileTerminal(command: TerminalCommand): Promise<ProcessorResult> {
    const snapshot = await this.fetchSnapshot(command);
    if (!snapshot) return RETRIED;
    const expectedStatus = command.terminalKind === 'complete' ? 'completed' : 'abandoned';
    if (snapshot.status !== expectedStatus) {
      await this.scheduleCanonicalRetry(command, 'CANONICAL_TERMINAL_BEHIND');
      return RETRIED;
    }
    const acknowledgement: TerminalAck = {
      disposition: 'duplicate',
      sessionId: command.sessionId,
      commandId: command.clientTerminalId,
      revision: snapshot.revision,
      status: expectedStatus,
    };
    await this.dependencies.repository.acknowledgeTerminal(
      this.dependencies.ownerId,
      command,
      acknowledgement,
      this.dependencies.clock.now(),
    );
    return APPLIED;
  }

  private async fetchSnapshot(command: SyncCommand): Promise<CanonicalSnapshot | null> {
    const lease = this.dependencies.requestLease();
    try {
      const snapshot = decodeSnapshot(
        await this.dependencies.transport.getSnapshot(command.sessionId, lease.signal),
      );
      if (!this.dependencies.isCurrent()) return null;
      if (snapshot.sessionId !== command.sessionId) {
        throw new ExamContractError('INVALID_SNAPSHOT', 'Snapshot session does not match command.');
      }
      await this.dependencies.repository.applySnapshot(
        this.dependencies.ownerId,
        snapshot,
        this.dependencies.clock.now(),
      );
      return this.dependencies.isCurrent() ? snapshot : null;
    } catch (error) {
      if (!this.dependencies.isCurrent()) return null;
      const failure = this.normalizeFailure(error);
      const classified = this.retry(command.retryCount, failure);
      const update: RetryUpdate = {
        ...classified,
        status: classified.status === 'blocked' ? 'blocked' : 'conflict',
      };
      await this.schedule(command, update);
      return null;
    } finally {
      lease.release();
    }
  }

  private async scheduleCanonicalRetry(command: SyncCommand, errorCode: string): Promise<void> {
    const retryCount = command.retryCount + 1;
    const exhausted = retryCount >= this.retryPolicy.maximumAttempts;
    const update: RetryUpdate = {
      status: exhausted ? 'blocked' : 'conflict',
      retryCount,
      nextRetryAt: exhausted
        ? Number.MAX_SAFE_INTEGER
        : this.dependencies.clock.now() +
          fullJitterDelay(retryCount, this.dependencies.random, this.retryPolicy),
      errorCode: exhausted ? 'RETRY_EXHAUSTED' : errorCode,
      updatedAt: this.dependencies.clock.now(),
    };
    await this.schedule(command, update);
  }

  private schedule(command: SyncCommand, update: RetryUpdate): Promise<void> {
    if (command.type === 'position') {
      return this.dependencies.repository.schedulePositionRetry(
        command.positionCommandId,
        update,
      );
    }
    if (command.type === 'answer') {
      return this.dependencies.repository.scheduleAnswerRetry(command.clientAnswerId, update);
    }
    return this.dependencies.repository.scheduleTerminalRetry(command.clientTerminalId, update);
  }

  private retry(currentRetryCount: number, failure: ExamTransportFailure): RetryUpdate {
    return classifyRetry(
      failure,
      currentRetryCount,
      this.dependencies.clock,
      this.dependencies.random,
      this.retryPolicy,
    );
  }

  private normalizeFailure(error: unknown): ExamTransportFailure {
    if (error instanceof ExamContractError) {
      return { status: null, code: error.code };
    }
    try {
      return this.dependencies.transport.normalizeFailure(error);
    } catch {
      return { status: null, code: 'NETWORK_UNKNOWN' };
    }
  }

  private retryFields(update: RetryUpdate): Pick<
    SyncCommand,
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

  private assertPositionAck(command: PositionCommand, acknowledgement: PositionAck): void {
    if (
      acknowledgement.sessionId !== command.sessionId ||
      acknowledgement.commandId !== command.positionCommandId ||
      acknowledgement.questionId !== command.questionId ||
      acknowledgement.positionSeq !== command.positionSeq
    ) {
      throw new ExamContractError('INVALID_ACK', 'Position ACK does not match its durable command.');
    }
  }

  private assertAnswerAck(command: AnswerCommand, acknowledgement: AnswerAck): void {
    if (
      acknowledgement.sessionId !== command.sessionId ||
      acknowledgement.commandId !== command.clientAnswerId ||
      acknowledgement.revision <= command.expectedRevision
    ) {
      throw new ExamContractError('INVALID_ACK', 'Answer ACK does not match its durable command.');
    }
  }

  private assertTerminalAck(command: TerminalCommand, acknowledgement: TerminalAck): void {
    const expectedStatus = command.terminalKind === 'complete' ? 'completed' : 'abandoned';
    if (
      acknowledgement.sessionId !== command.sessionId ||
      acknowledgement.commandId !== command.clientTerminalId ||
      acknowledgement.revision < command.expectedRevision ||
      acknowledgement.status !== expectedStatus
    ) {
      throw new ExamContractError('INVALID_ACK', 'Terminal ACK does not match its durable command.');
    }
  }
}

export function earliestPerSession<T extends SyncCommand>(
  commands: readonly T[],
  commandId: (command: T) => string,
): readonly T[] {
  const heads = new Map<string, T>();
  for (const command of commands) {
    const current = heads.get(command.sessionId);
    if (
      !current ||
      command.createdAt < current.createdAt ||
      (command.createdAt === current.createdAt && commandId(command) < commandId(current))
    ) {
      heads.set(command.sessionId, command);
    }
  }
  return [...heads.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt || commandId(left).localeCompare(commandId(right)),
  );
}
