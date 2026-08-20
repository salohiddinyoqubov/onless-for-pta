import { ExamSyncWorker, type ExamSyncWorkerOptions } from '../src/exam/offline/sync-worker';
import type { Connectivity } from '../src/exam/ports';
import {
  DEMO_ANSWER_COMMAND_ID, DEMO_OWNER_ID, DEMO_POSITION_COMMAND_ID, DEMO_QUESTION_ID,
  DEMO_SESSION_ID, DEMO_TERMINAL_COMMAND_ID, FixedRandom, FakeTransport, ManualClock,
  MemoryRepository, MutableConnectivity, SECOND_OWNER_ID, SECOND_SESSION_ID,
  answerCommand, deferred, positionCommand, terminalCommand, transportError,
} from './fixtures';
function createWorker(repository: MemoryRepository, transport: FakeTransport,
  overrides: Partial<ExamSyncWorkerOptions> = {}): { readonly worker: ExamSyncWorker; readonly clock: ManualClock } {
  const clock = overrides.clock instanceof ManualClock ? overrides.clock : new ManualClock();
  return { clock, worker: new ExamSyncWorker(repository, transport, {
    clock, random: new FixedRandom(0.5), connectivity: new MutableConnectivity(true),
    requestTimeoutMs: 1_000, ...overrides,
  }) };
}
async function flushAsyncWork(): Promise<void> {
  for (let iteration = 0; iteration < 3; iteration += 1) await Promise.resolve();
}
async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
describe('ExamSyncWorker ordering and reconciliation', () => {
  it('drains positions, then answers, then terminal commands', async () => {
    const repository = new MemoryRepository();
    repository.positions = [positionCommand()];
    repository.answers = [answerCommand()];
    repository.terminals = [terminalCommand()];
    const transport = new FakeTransport();
    const { worker } = createWorker(repository, transport);
    await expect(worker.run(DEMO_OWNER_ID)).resolves.toEqual({
      processedPositions: 1,
      processedAnswers: 1,
      processedTerminals: 1,
      stoppedByBudget: false,
      cancelled: false,
      offline: false,
    });
    expect(transport.events).toEqual([
      `position:${DEMO_SESSION_ID}`,
      `answer:${DEMO_SESSION_ID}`,
      `terminal:${DEMO_SESSION_ID}`,
    ]);
  });
  it('does not overtake the earliest failed answer from the same session', async () => {
    const repository = new MemoryRepository();
    const later = answerCommand({
      clientAnswerId: '50000000-0000-4000-8000-000000000002',
      createdAt: 9_001,
    });
    repository.answers = [later, answerCommand()];
    const transport = new FakeTransport();
    transport.answerHandler = async () =>
      Promise.reject(transportError({ status: null, code: 'NETWORK_TIMEOUT' }));
    const { worker } = createWorker(repository, transport);
    const result = await worker.run(DEMO_OWNER_ID);
    expect(result.processedAnswers).toBe(1);
    expect(transport.answerRequests.map(({ client_answer_id }) => client_answer_id)).toEqual([
      DEMO_ANSWER_COMMAND_ID,
    ]);
    expect(repository.answers).toContainEqual(later);
  });
  it('processes one deterministic head from each independent session', async () => {
    const repository = new MemoryRepository();
    repository.answers = [
      answerCommand(),
      answerCommand({
        sessionId: SECOND_SESSION_ID,
        clientAnswerId: '50000000-0000-4000-8000-000000000002',
      }),
    ];
    const transport = new FakeTransport();
    const { worker } = createWorker(repository, transport);
    const result = await worker.run(DEMO_OWNER_ID);
    expect(result.processedAnswers).toBe(2);
    expect(transport.events).toEqual([
      `answer:${DEMO_SESSION_ID}`,
      `answer:${SECOND_SESSION_ID}`,
    ]);
  });
  it('sends the revision returned by the durable claim boundary', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand({ expectedRevision: 1 })];
    jest.spyOn(repository, 'claimAnswerForSync').mockResolvedValue(
      answerCommand({ expectedRevision: 7 }),
    );
    const transport = new FakeTransport();
    const { worker } = createWorker(repository, transport);
    await worker.run(DEMO_OWNER_ID);
    expect(transport.answerRequests[0]?.expected_revision).toBe(7);
  });
  it('reconciles an answer conflict from a strict canonical snapshot', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand({ expectedRevision: 3 })];
    const transport = new FakeTransport();
    transport.answerHandler = async () =>
      Promise.reject(transportError({ status: 409, code: 'REVISION_CONFLICT' }));
    transport.snapshotHandler = async (sessionId) => ({
      session_id: sessionId,
      revision: 4,
      position_seq: 2,
      status: 'in_progress',
    });
    const { worker } = createWorker(repository, transport);
    const result = await worker.run(DEMO_OWNER_ID);
    expect(result.processedAnswers).toBe(1);
    expect(repository.snapshots).toHaveLength(1);
    expect(repository.answerAcks[0]).toMatchObject({
      disposition: 'duplicate',
      commandId: DEMO_ANSWER_COMMAND_ID,
      revision: 4,
    });
    expect(repository.answers).toHaveLength(0);
  });
  it('keeps a conflict durable when the canonical revision has not advanced', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand({ expectedRevision: 3 })];
    const transport = new FakeTransport();
    transport.answerHandler = async () => Promise.reject(transportError({ status: 409 }));
    transport.snapshotHandler = async (sessionId) => ({
      session_id: sessionId,
      revision: 3,
      position_seq: 2,
      status: 'in_progress',
    });
    const { worker, clock } = createWorker(repository, transport);
    await worker.run(DEMO_OWNER_ID);
    expect(repository.answerAcks).toHaveLength(0);
    expect(repository.answerRetries).toHaveLength(2);
    expect(repository.answers[0]).toMatchObject({
      status: 'conflict',
      retryCount: 2,
      nextRetryAt: clock.now() + 2_000,
      lastErrorCode: 'CANONICAL_REVISION_BEHIND',
    });
  });
  it('reconciles position and terminal conflicts without answer content', async () => {
    const repository = new MemoryRepository();
    repository.positions = [positionCommand({ status: 'conflict' })];
    repository.terminals = [terminalCommand({ status: 'conflict' })];
    const transport = new FakeTransport();
    transport.snapshotHandler = async (sessionId) => ({
      session_id: sessionId,
      revision: 5,
      position_seq: 4,
      status: 'completed',
    });
    const { worker } = createWorker(repository, transport);
    await worker.run(DEMO_OWNER_ID);
    expect(repository.positionAcks[0]).toMatchObject({ disposition: 'duplicate' });
    expect(repository.terminalAcks[0]).toMatchObject({
      disposition: 'duplicate',
      status: 'completed',
    });
    expect(transport.positionRequests).toHaveLength(0);
    expect(transport.terminalRequests).toHaveLength(0);
  });
  it('never acknowledges a malformed response body', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    const transport = new FakeTransport();
    transport.answerHandler = async () => '<html>offline gateway</html>';
    const { worker } = createWorker(repository, transport);
    await worker.run(DEMO_OWNER_ID);
    expect(repository.answerAcks).toHaveLength(0);
    expect(repository.answerRetries[0]).toMatchObject({
      status: 'pending',
      errorCode: 'INVALID_ACK',
    });
  });
  it('rejects malformed position and terminal acknowledgements independently', async () => {
    const repository = new MemoryRepository();
    repository.positions = [positionCommand()];
    repository.terminals = [terminalCommand()];
    const transport = new FakeTransport();
    transport.positionHandler = async () => ({ disposition: 'accepted' });
    transport.terminalHandler = async (sessionId, _kind, request) => ({
      disposition: 'accepted',
      session_id: sessionId,
      client_terminal_id: request.client_terminal_id,
      revision: 1,
      status: 'in_progress',
    });
    const { worker } = createWorker(repository, transport);
    await worker.run(DEMO_OWNER_ID);
    expect(repository.positionAcks).toEqual([]);
    expect(repository.terminalAcks).toEqual([]);
    expect(repository.positionRetries[0]).toMatchObject({ errorCode: 'INVALID_ACK' });
    expect(repository.terminalRetries[0]).toMatchObject({ errorCode: 'INVALID_ACK' });
  });
  it.each([
    ['session_id', SECOND_SESSION_ID],
    ['position_command_id', '40000000-0000-4000-8000-000000000099'],
    ['question_id', '20000000-0000-4000-8000-000000000099'],
    ['position_seq', 99],
  ] as const)('rejects a position ACK with mismatched %s', async (field, value) => {
    const repository = new MemoryRepository();
    repository.positions = [positionCommand()];
    const transport = new FakeTransport();
    transport.positionHandler = async () => ({
      disposition: 'accepted',
      session_id: DEMO_SESSION_ID,
      position_command_id: DEMO_POSITION_COMMAND_ID,
      question_id: DEMO_QUESTION_ID,
      position_seq: 1,
      [field]: value,
    });
    await createWorker(repository, transport).worker.run(DEMO_OWNER_ID);
    expect(repository.positionAcks).toEqual([]);
    expect(repository.positionRetries[0]).toMatchObject({ errorCode: 'INVALID_ACK' });
  });
  it.each([
    ['session_id', SECOND_SESSION_ID],
    ['client_terminal_id', '60000000-0000-4000-8000-000000000099'],
    ['revision', 0],
    ['status', 'abandoned'],
  ] as const)('rejects a terminal ACK with mismatched %s', async (field, value) => {
    const repository = new MemoryRepository();
    repository.terminals = [terminalCommand()];
    const transport = new FakeTransport();
    transport.terminalHandler = async () => ({
      disposition: 'accepted',
      session_id: DEMO_SESSION_ID,
      client_terminal_id: DEMO_TERMINAL_COMMAND_ID,
      revision: 1,
      status: 'completed',
      [field]: value,
    });
    await createWorker(repository, transport).worker.run(DEMO_OWNER_ID);
    expect(repository.terminalAcks).toEqual([]);
    expect(repository.terminalRetries[0]).toMatchObject({ errorCode: 'INVALID_ACK' });
  });
  it('keeps position and terminal conflicts when canonical state is behind', async () => {
    const repository = new MemoryRepository();
    repository.positions = [positionCommand({ status: 'conflict', positionSeq: 4 })];
    repository.terminals = [terminalCommand({ status: 'conflict' })];
    const transport = new FakeTransport();
    transport.snapshotHandler = async (sessionId) => ({
      session_id: sessionId,
      revision: 1,
      position_seq: 3,
      status: 'in_progress',
    });
    const { worker } = createWorker(repository, transport);
    await worker.run(DEMO_OWNER_ID);
    expect(repository.positionAcks).toEqual([]);
    expect(repository.terminalAcks).toEqual([]);
    expect(repository.positionRetries[0]).toMatchObject({
      status: 'conflict',
      errorCode: 'CANONICAL_POSITION_BEHIND',
    });
    expect(repository.terminalRetries[0]).toMatchObject({
      status: 'conflict',
      errorCode: 'CANONICAL_TERMINAL_BEHIND',
    });
  });
  it('blocks an exhausted reconciliation snapshot failure', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand({ status: 'conflict', retryCount: 2 })];
    const transport = new FakeTransport();
    transport.snapshotHandler = async () =>
      Promise.reject(transportError({ status: 503, code: 'SNAPSHOT_UNAVAILABLE' }));
    const { worker } = createWorker(repository, transport, {
      retryPolicy: { baseDelayMs: 100, maximumDelayMs: 1_000, maximumAttempts: 3 },
    });
    await worker.run(DEMO_OWNER_ID);
    expect(repository.snapshots).toEqual([]);
    expect(repository.answerAcks).toEqual([]);
    expect(repository.answerRetries[0]).toMatchObject({
      status: 'blocked',
      retryCount: 3,
      errorCode: 'RETRY_EXHAUSTED',
    });
  });
  it('reuses durable command identity after a rate-limit delay', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    const transport = new FakeTransport();
    let attempt = 0;
    transport.answerHandler = async (sessionId, request) => {
      attempt += 1;
      if (attempt === 1) {
        throw transportError({
          status: 429,
          body: { retry_after: 3 },
          retryAfterHeader: '3',
        });
      }
      return {
        disposition: 'duplicate',
        session_id: sessionId,
        client_answer_id: request.client_answer_id,
        revision: 1,
      };
    };
    const clock = new ManualClock();
    const { worker } = createWorker(repository, transport, { clock });
    await worker.run(DEMO_OWNER_ID);
    expect(repository.answers[0]?.nextRetryAt).toBe(13_000);
    clock.advance(3_000);
    await worker.run(DEMO_OWNER_ID);
    expect(transport.answerRequests.map(({ client_answer_id }) => client_answer_id)).toEqual([
      DEMO_ANSWER_COMMAND_ID,
      DEMO_ANSWER_COMMAND_ID,
    ]);
    expect(repository.answers).toHaveLength(0);
  });
  it('blocks retry exhaustion and makes no further transport call', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand({ retryCount: 2 })];
    const transport = new FakeTransport();
    transport.answerHandler = async () => Promise.reject(transportError({ status: 503 }));
    const { worker } = createWorker(repository, transport, {
      retryPolicy: { baseDelayMs: 100, maximumDelayMs: 1_000, maximumAttempts: 3 },
    });
    await worker.run(DEMO_OWNER_ID);
    await worker.run(DEMO_OWNER_ID);
    expect(transport.answerRequests).toHaveLength(1);
    expect(repository.answers[0]).toMatchObject({
      status: 'blocked',
      retryCount: 3,
      lastErrorCode: 'RETRY_EXHAUSTED',
    });
  });
  it('never sends a terminal while an answer remains unacknowledged', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    repository.terminals = [terminalCommand()];
    const transport = new FakeTransport();
    transport.answerHandler = async () => Promise.reject(transportError({ status: null }));
    const { worker } = createWorker(repository, transport);
    await worker.run(DEMO_OWNER_ID);
    expect(transport.answerRequests).toHaveLength(1);
    expect(transport.terminalRequests).toHaveLength(0);
  });
});
describe('ExamSyncWorker budgets and cancellation barriers', () => {
  it('does not cross a repository or transport boundary while offline', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    const transport = new FakeTransport();
    const { worker } = createWorker(repository, transport, {
      connectivity: new MutableConnectivity(false),
    });
    await expect(worker.run(DEMO_OWNER_ID)).resolves.toMatchObject({
      offline: true,
      processedAnswers: 0,
    });
    expect(transport.events).toEqual([]);
    expect(repository.events).toEqual([]);
  });
  it('ends a stalled connectivity probe at the run deadline without durable writes', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    const observedSignals: AbortSignal[] = [];
    const connectivity: Connectivity = {
      isOnline: (signal) => {
        observedSignals.push(signal);
        return new Promise<boolean>(() => undefined);
      },
    };
    const clock = new ManualClock();
    const { worker } = createWorker(repository, new FakeTransport(), {
      clock,
      connectivity,
      requestTimeoutMs: 5_000,
      timeBudgetMs: 400,
    });
    const run = worker.run(DEMO_OWNER_ID);
    await waitUntil(() => observedSignals.length === 1, 'the connectivity probe to start');
    clock.advance(400);
    await expect(run).resolves.toEqual({
      processedPositions: 0,
      processedAnswers: 0,
      processedTerminals: 0,
      stoppedByBudget: true,
      cancelled: false,
      offline: false,
    });
    expect(observedSignals[0]?.aborted).toBe(true);
    expect(repository.events).toEqual([]);
    expect(repository.answerAcks).toEqual([]);
    expect(repository.answerRetries).toEqual([]);
    expect(clock.pendingTimers()).toBe(0);
  });
  it('allows cancelOwner to finish when a connectivity implementation ignores abort', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    const observedSignals: AbortSignal[] = [];
    const connectivity: Connectivity = {
      isOnline: (signal) => {
        observedSignals.push(signal);
        return new Promise<boolean>(() => undefined);
      },
    };
    const { worker } = createWorker(repository, new FakeTransport(), { connectivity });
    const run = worker.run(DEMO_OWNER_ID);
    await waitUntil(() => observedSignals.length === 1, 'the cancellable connectivity probe');
    const cancellation = worker.cancelOwner(DEMO_OWNER_ID);
    await expect(run).resolves.toMatchObject({ cancelled: true, processedAnswers: 0 });
    await expect(cancellation).resolves.toBeUndefined();
    expect(observedSignals[0]?.aborted).toBe(true);
    expect(repository.events).toEqual([`release:${DEMO_OWNER_ID}`]);
    expect(repository.answerAcks).toEqual([]);
    expect(repository.answerRetries).toEqual([]);
  });
  it('stops exactly at the command-count budget', async () => {
    const repository = new MemoryRepository();
    repository.answers = [
      answerCommand(),
      answerCommand({
        sessionId: SECOND_SESSION_ID,
        clientAnswerId: '50000000-0000-4000-8000-000000000002',
      }),
      answerCommand({
        sessionId: '10000000-0000-4000-8000-000000000003',
        clientAnswerId: '50000000-0000-4000-8000-000000000003',
      }),
    ];
    const transport = new FakeTransport();
    const { worker } = createWorker(repository, transport, { maximumCommandsPerRun: 2 });
    await expect(worker.run(DEMO_OWNER_ID)).resolves.toMatchObject({
      processedAnswers: 2,
      stoppedByBudget: true,
    });
    expect(transport.answerRequests).toHaveLength(2);
    expect(repository.answers).toHaveLength(1);
  });
  it('stops after a command consumes the injected time budget', async () => {
    const repository = new MemoryRepository();
    repository.answers = [
      answerCommand(),
      answerCommand({
        sessionId: SECOND_SESSION_ID,
        clientAnswerId: '50000000-0000-4000-8000-000000000002',
      }),
    ];
    const transport = new FakeTransport();
    const clock = new ManualClock();
    transport.answerHandler = async (sessionId, request) => {
      clock.advance(500);
      return {
        disposition: 'accepted',
        session_id: sessionId,
        client_answer_id: request.client_answer_id,
        revision: 1,
      };
    };
    const { worker } = createWorker(repository, transport, { clock, timeBudgetMs: 500 });
    await expect(worker.run(DEMO_OWNER_ID)).resolves.toMatchObject({
      processedAnswers: 1,
      stoppedByBudget: true,
    });
  });
  it('deduplicates concurrent runs for the same scope', () => {
    const repository = new MemoryRepository();
    const transport = new FakeTransport();
    const { worker } = createWorker(repository, transport);
    const first = worker.run(DEMO_OWNER_ID, DEMO_SESSION_ID);
    const second = worker.run(DEMO_OWNER_ID, DEMO_SESSION_ID);
    expect(second).toBe(first);
    return first;
  });
  it('serializes different session scopes for the same owner', async () => {
    const repository = new MemoryRepository();
    repository.answers = [
      answerCommand(),
      answerCommand({
        sessionId: SECOND_SESSION_ID,
        clientAnswerId: '50000000-0000-4000-8000-000000000002',
      }),
    ];
    const firstResponse = deferred<unknown>();
    const transport = new FakeTransport();
    transport.answerHandler = async (sessionId, request) => {
      if (sessionId === DEMO_SESSION_ID) return firstResponse.promise;
      return {
        disposition: 'accepted',
        session_id: sessionId,
        client_answer_id: request.client_answer_id,
        revision: 1,
      };
    };
    const { worker } = createWorker(repository, transport);
    const first = worker.run(DEMO_OWNER_ID, DEMO_SESSION_ID);
    await waitUntil(
      () => transport.events.includes(`answer:${DEMO_SESSION_ID}`),
      'the first owner scope to reach transport',
    );
    const second = worker.run(DEMO_OWNER_ID, SECOND_SESSION_ID);
    await flushAsyncWork();
    expect(transport.events).toEqual([`answer:${DEMO_SESSION_ID}`]);
    firstResponse.resolve({
      disposition: 'accepted',
      session_id: DEMO_SESSION_ID,
      client_answer_id: DEMO_ANSWER_COMMAND_ID,
      revision: 1,
    });
    await expect(first).resolves.toMatchObject({ processedAnswers: 1 });
    await expect(second).resolves.toMatchObject({ processedAnswers: 1 });
    expect(transport.events).toEqual([
      `answer:${DEMO_SESSION_ID}`,
      `answer:${SECOND_SESSION_ID}`,
    ]);
  });
  it('holds a same-owner restart behind interrupted-command release', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    const transport = new FakeTransport();
    const lifecycle: string[] = [];
    let transportAttempt = 0;
    transport.answerHandler = async (sessionId, request, signal) => {
      transportAttempt += 1;
      if (transportAttempt > 1) {
        lifecycle.push('restart-transport');
        return {
          disposition: 'accepted', session_id: sessionId,
          client_answer_id: request.client_answer_id, revision: 1,
        };
      }
      return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => {
        lifecycle.push('transport-aborted');
        reject(transportError({ status: null, code: 'REQUEST_ABORTED' }));
      }, { once: true }));
    };
    const releaseStarted = deferred<void>();
    const finishRelease = deferred<void>();
    jest.spyOn(repository, 'releaseInterruptedCommands').mockImplementation(async () => {
      lifecycle.push('release-started');
      releaseStarted.resolve();
      await finishRelease.promise;
      lifecycle.push('release-finished');
    });
    const listAnswers = jest.spyOn(repository, 'listDueAnswerCommands');
    const { worker } = createWorker(repository, transport);
    const interrupted = worker.run(DEMO_OWNER_ID);
    await waitUntil(
      () => transport.events.includes(`answer:${DEMO_SESSION_ID}`),
      'the owner request to reach transport',
    );
    const cancellation = worker.cancelOwner(DEMO_OWNER_ID);
    await releaseStarted.promise;
    const readsBeforeRestart = listAnswers.mock.calls.length;
    const restart = worker.run(DEMO_OWNER_ID);
    expect(worker.run(DEMO_OWNER_ID)).toBe(restart);
    await flushAsyncWork();
    expect(listAnswers).toHaveBeenCalledTimes(readsBeforeRestart);
    expect(transport.answerRequests).toHaveLength(1);
    finishRelease.resolve();
    await expect(interrupted).resolves.toMatchObject({ cancelled: true });
    await expect(cancellation).resolves.toBeUndefined();
    await expect(restart).resolves.toMatchObject({ processedAnswers: 1, cancelled: false });
    expect(lifecycle).toEqual([
      'transport-aborted', 'release-started', 'release-finished', 'restart-transport',
    ]);
  });
  it('waits for every concurrent cancellation tail before restarting once', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    const releases = [deferred<void>(), deferred<void>()];
    const releaseStarts = [deferred<void>(), deferred<void>()];
    let releaseIndex = 0;
    jest.spyOn(repository, 'releaseInterruptedCommands').mockImplementation(async () => {
      const index = releaseIndex++;
      releaseStarts[index]?.resolve();
      await releases[index]?.promise;
    });
    const listAnswers = jest.spyOn(repository, 'listDueAnswerCommands');
    const transport = new FakeTransport();
    const { worker } = createWorker(repository, transport);
    const firstCancellation = worker.cancelOwner(DEMO_OWNER_ID);
    await releaseStarts[0]?.promise;
    const secondCancellation = worker.cancelOwner(DEMO_OWNER_ID);
    const restart = worker.run(DEMO_OWNER_ID);
    expect(worker.run(DEMO_OWNER_ID)).toBe(restart);
    await flushAsyncWork();
    expect(listAnswers).not.toHaveBeenCalled();
    releases[0]?.resolve();
    await releaseStarts[1]?.promise;
    await flushAsyncWork();
    expect(listAnswers).not.toHaveBeenCalled();
    expect(transport.events).toEqual([]);
    releases[1]?.resolve();
    await expect(Promise.all([firstCancellation, secondCancellation])).resolves.toEqual([
      undefined, undefined,
    ]);
    await expect(restart).resolves.toMatchObject({ processedAnswers: 1 });
    expect(releaseIndex).toBe(2);
    expect(transport.events).toEqual([`answer:${DEMO_SESSION_ID}`]);
  });
  it('cancels owner A before owner B reaches transport', async () => {
    const repository = new MemoryRepository();
    repository.answers = [
      answerCommand(),
      answerCommand({
        ownerId: SECOND_OWNER_ID,
        sessionId: SECOND_SESSION_ID,
        clientAnswerId: '50000000-0000-4000-8000-000000000002',
      }),
    ];
    const lifecycle: string[] = [];
    const transport = new FakeTransport();
    transport.answerHandler = async (sessionId, request, signal) => {
      if (sessionId === DEMO_SESSION_ID) {
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              lifecycle.push('owner-a-aborted');
              reject(transportError({ status: null }));
            },
            { once: true },
          );
        });
      }
      lifecycle.push('owner-b-transport');
      return {
        disposition: 'accepted',
        session_id: sessionId,
        client_answer_id: request.client_answer_id,
        revision: 1,
      };
    };
    jest.spyOn(repository, 'releaseInterruptedCommands').mockImplementation(async (ownerId) => {
      lifecycle.push(`released:${ownerId}`);
    });
    const { worker } = createWorker(repository, transport);
    const ownerA = worker.run(DEMO_OWNER_ID);
    await waitUntil(
      () => transport.events.includes(`answer:${DEMO_SESSION_ID}`),
      'owner A to reach transport',
    );
    const ownerB = worker.run(SECOND_OWNER_ID);
    await expect(ownerA).resolves.toMatchObject({ cancelled: true });
    await expect(ownerB).resolves.toMatchObject({ processedAnswers: 1 });
    expect(lifecycle).toEqual([
      'owner-a-aborted',
      `released:${DEMO_OWNER_ID}`,
      'owner-b-transport',
    ]);
  });
  it('uses the injected timeout scheduler to abort a stalled request', async () => {
    const repository = new MemoryRepository();
    repository.answers = [answerCommand()];
    const transport = new FakeTransport();
    transport.answerHandler = async (_sessionId, _request, signal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(transportError({ status: null, code: 'REQUEST_TIMEOUT' })),
          { once: true },
        );
      });
    const clock = new ManualClock();
    const { worker } = createWorker(repository, transport, { clock, requestTimeoutMs: 250 });
    const run = worker.run(DEMO_OWNER_ID);
    await waitUntil(
      () => transport.events.includes(`answer:${DEMO_SESSION_ID}`),
      'the stalled request to reach transport',
    );
    expect(clock.pendingTimers()).toBe(1);
    clock.advance(250);
    await expect(run).resolves.toMatchObject({ processedAnswers: 1, cancelled: false });
    expect(repository.answerRetries[0]).toMatchObject({ errorCode: 'REQUEST_TIMEOUT' });
    expect(clock.pendingTimers()).toBe(0);
  });
  it('propagates interrupted-command release failure even when its reporter fails', async () => {
    const repository = new MemoryRepository();
    const releaseFailure = new Error('Synthetic release failure');
    repository.releaseError = releaseFailure;
    const reporter = jest.fn(() => {
      throw new Error('Synthetic reporter failure');
    });
    const { worker } = createWorker(repository, new FakeTransport(), {
      reportBackgroundError: reporter,
    });
    await expect(worker.cancelOwner(DEMO_OWNER_ID)).rejects.toBe(releaseFailure);
    expect(reporter).toHaveBeenCalledWith(releaseFailure, {
      operation: 'release-interrupted-sync',
      ownerId: DEMO_OWNER_ID,
    });
  });
});
