export interface ConfirmAnswerInput {
  ownerId: string;
  sessionId: string;
  questionId: string;
  answerId: string;
  clientAnswerId: string;
  elapsedMs: number;
  now: number;
}

export interface AnswerCommand extends ConfirmAnswerInput {
  expectedRevision: number;
  status: 'pending';
  retryCount: number;
  nextRetryAt: number;
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AnswerRepository {
  confirmAnswer(input: ConfirmAnswerInput): Promise<AnswerCommand>;
}

export interface AnswerSyncWorker {
  run(ownerId: string, sessionId: string): Promise<unknown>;
}

export interface BackgroundErrorContext {
  operation: 'answer-sync';
  ownerId: string;
  sessionId: string;
}

export type BackgroundErrorReporter = (
  error: unknown,
  context: BackgroundErrorContext,
) => void | Promise<void>;

/**
 * Persists an answer command before starting best-effort network delivery.
 * The durable command remains the source of truth when connectivity is absent.
 */
export class DurableAnswerQueue {
  public constructor(
    private readonly repository: AnswerRepository,
    private readonly worker: AnswerSyncWorker,
    private readonly reportBackgroundError: BackgroundErrorReporter,
  ) {}

  public async confirm(
    input: ConfirmAnswerInput,
    isCurrentOwner: () => boolean = () => true,
  ): Promise<AnswerCommand> {
    const durableCommand = await this.repository.confirmAnswer(input);

    if (!isCurrentOwner()) {
      return durableCommand;
    }

    this.startBackgroundSync(input.ownerId, input.sessionId);
    return durableCommand;
  }

  private startBackgroundSync(ownerId: string, sessionId: string): void {
    const context: BackgroundErrorContext = {
      operation: 'answer-sync',
      ownerId,
      sessionId,
    };

    try {
      void this.worker
        .run(ownerId, sessionId)
        .catch((error: unknown) => this.reportSafely(error, context));
    } catch (error: unknown) {
      this.reportSafely(error, context);
    }
  }

  private reportSafely(error: unknown, context: BackgroundErrorContext): void {
    try {
      void Promise.resolve(this.reportBackgroundError(error, context)).catch(
        () => undefined,
      );
    } catch {
      // Reporting must not change confirmation semantics.
    }
  }
}
