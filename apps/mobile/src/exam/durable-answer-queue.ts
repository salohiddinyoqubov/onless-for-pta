import type { AnswerCommand, ConfirmAnswerInput } from './domain/contracts';
import type {
  AnswerSyncWorker,
  AnswerWriteRepository,
  BackgroundErrorContext,
  ExamBackgroundErrorReporter,
} from './ports';
import { reportBackgroundErrorSafely } from './offline/sync-worker';

export type {
  AnswerCommand,
  ConfirmAnswerInput,
  AnswerSyncWorker,
  AnswerWriteRepository as AnswerRepository,
  BackgroundErrorContext,
  ExamBackgroundErrorReporter as BackgroundErrorReporter,
};

export class DurableAnswerQueue {
  public constructor(
    private readonly repository: AnswerWriteRepository,
    private readonly worker: AnswerSyncWorker,
    private readonly reportBackgroundError: ExamBackgroundErrorReporter,
  ) {}

  public async confirm(
    input: ConfirmAnswerInput,
    isCurrentOwner: () => boolean = () => true,
  ): Promise<AnswerCommand> {
    const durableCommand = await this.repository.confirmAnswer(input);
    if (!isCurrentOwner()) return durableCommand;
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
        .catch((error: unknown) =>
          reportBackgroundErrorSafely(this.reportBackgroundError, error, context),
        );
    } catch (error) {
      reportBackgroundErrorSafely(this.reportBackgroundError, error, context);
    }
  }
}
