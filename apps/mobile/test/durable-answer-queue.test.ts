import {
  DurableAnswerQueue,
  type AnswerCommand,
  type AnswerRepository,
  type AnswerSyncWorker,
  type BackgroundErrorReporter,
  type ConfirmAnswerInput,
} from '../src/exam/durable-answer-queue';
import {
  DEMO_ANSWER_COMMAND_ID,
  DEMO_ANSWER_ID,
  DEMO_OWNER_ID,
  DEMO_QUESTION_ID,
  DEMO_SESSION_ID,
} from './fixtures';
const input: ConfirmAnswerInput = {
  ownerId: DEMO_OWNER_ID,
  sessionId: DEMO_SESSION_ID,
  questionId: DEMO_QUESTION_ID,
  answerId: DEMO_ANSWER_ID,
  clientAnswerId: DEMO_ANSWER_COMMAND_ID,
  elapsedMs: 500,
  now: 1_000,
};
const command: AnswerCommand = {
  type: 'answer',
  ownerId: input.ownerId,
  sessionId: input.sessionId,
  questionId: input.questionId,
  answerId: input.answerId,
  clientAnswerId: input.clientAnswerId,
  elapsedMs: input.elapsedMs,
  expectedRevision: 0,
  status: 'pending',
  retryCount: 0,
  nextRetryAt: input.now,
  lastErrorCode: null,
  createdAt: input.now,
  updatedAt: input.now,
};
describe('DurableAnswerQueue', () => {
  it('commits locally before scheduling network delivery', async () => {
    const order: string[] = [];
    const repository: AnswerRepository = {
      confirmAnswer: jest.fn(async () => {
        order.push('local-commit');
        return command;
      }),
    };
    const worker: AnswerSyncWorker = {
      run: jest.fn(async () => {
        order.push('network-delivery');
      }),
    };
    await expect(
      new DurableAnswerQueue(repository, worker, jest.fn()).confirm(input),
    ).resolves.toBe(command);
    expect(order).toEqual(['local-commit', 'network-delivery']);
  });
  it('does not schedule network delivery when the durable write fails', async () => {
    const repository: AnswerRepository = {
      confirmAnswer: jest.fn(async () =>
        Promise.reject(new Error('storage unavailable')),
      ),
    };
    const worker: AnswerSyncWorker = {
      run: jest.fn(async () => undefined),
    };
    await expect(
      new DurableAnswerQueue(repository, worker, jest.fn()).confirm(input),
    ).rejects.toThrow('storage unavailable');
    expect(worker.run).not.toHaveBeenCalled();
  });
  it('suppresses delivery when ownership changes during the durable write', async () => {
    let finishWrite: ((value: AnswerCommand) => void) | undefined;
    const repository: AnswerRepository = {
      confirmAnswer: jest.fn(
        () =>
          new Promise<AnswerCommand>((resolve) => {
            finishWrite = resolve;
          }),
      ),
    };
    const worker: AnswerSyncWorker = {
      run: jest.fn(async () => undefined),
    };
    let isCurrentOwner = true;
    const confirmation = new DurableAnswerQueue(
      repository,
      worker,
      jest.fn(),
    ).confirm(input, () => isCurrentOwner);
    isCurrentOwner = false;
    finishWrite?.(command);
    await expect(confirmation).resolves.toBe(command);
    expect(worker.run).not.toHaveBeenCalled();
  });
  it('contains background delivery and synchronous reporting failures', async () => {
    const failure = new Error('delivery failed');
    const repository: AnswerRepository = {
      confirmAnswer: jest.fn(async () => command),
    };
    const worker: AnswerSyncWorker = {
      run: jest.fn(async () => Promise.reject(failure)),
    };
    const reporter: BackgroundErrorReporter = jest.fn(() => {
      throw new Error('reporter unavailable');
    });
    await expect(
      new DurableAnswerQueue(repository, worker, reporter).confirm(input),
    ).resolves.toBe(command);
    await Promise.resolve();
    expect(reporter).toHaveBeenCalledWith(failure, {
      operation: 'answer-sync',
      ownerId: input.ownerId,
      sessionId: input.sessionId,
    });
  });
  it('contains synchronously thrown worker failures', async () => {
    const failure = new Error('worker failed before returning');
    const repository: AnswerRepository = {
      confirmAnswer: jest.fn(async () => command),
    };
    const worker: AnswerSyncWorker = {
      run: jest.fn(() => {
        throw failure;
      }),
    };
    const reporter = jest.fn();
    await expect(
      new DurableAnswerQueue(repository, worker, reporter).confirm(input),
    ).resolves.toBe(command);
    expect(reporter).toHaveBeenCalledWith(failure, {
      operation: 'answer-sync',
      ownerId: input.ownerId,
      sessionId: input.sessionId,
    });
  });
  it('contains asynchronously rejected reporting', async () => {
    const failure = new Error('delivery failed');
    const repository: AnswerRepository = {
      confirmAnswer: jest.fn(async () => command),
    };
    const worker: AnswerSyncWorker = {
      run: jest.fn(async () => Promise.reject(failure)),
    };
    const reporter: BackgroundErrorReporter = jest.fn(async () =>
      Promise.reject(new Error('reporter unavailable')),
    );
    await expect(
      new DurableAnswerQueue(repository, worker, reporter).confirm(input),
    ).resolves.toBe(command);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reporter).toHaveBeenCalledTimes(1);
  });
});
