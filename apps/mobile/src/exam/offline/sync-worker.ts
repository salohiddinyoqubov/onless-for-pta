import type { SyncRunResult } from '../domain/contracts';
import type {
  BackgroundErrorContext,
  Clock,
  Connectivity,
  ExamBackgroundErrorReporter,
  ExamSyncTransport,
  RandomSource,
  SyncCommandStore,
} from '../ports';
import type { RetryPolicy } from './backoff';
import { probeConnectivity } from './connectivity-probe';
import {
  CommandProcessors,
  earliestPerSession,
  type ProcessorResult,
  type RequestLease,
} from './processors';

interface ActiveRun {
  readonly ownerId: string;
  readonly generation: number;
  readonly promise: Promise<SyncRunResult>;
}

interface QueuedRun {
  readonly ownerId: string;
  readonly promise: Promise<SyncRunResult>;
}

interface RunCounters {
  positions: number;
  answers: number;
  terminals: number;
}

export interface ExamSyncWorkerOptions {
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly connectivity: Connectivity;
  readonly maximumCommandsPerRun?: number;
  readonly timeBudgetMs?: number;
  readonly requestTimeoutMs?: number;
  readonly retryPolicy?: RetryPolicy;
  readonly reportBackgroundError?: ExamBackgroundErrorReporter;
}

const ZERO_COUNTS: Readonly<RunCounters> = { positions: 0, answers: 0, terminals: 0 };

export function reportBackgroundErrorSafely(
  reporter: ExamBackgroundErrorReporter | undefined,
  error: unknown,
  context: BackgroundErrorContext,
): void {
  try {
    void Promise.resolve(reporter?.(error, context)).catch(() => undefined);
  } catch {
    // Diagnostic delivery is deliberately isolated from durable command semantics.
  }
}

export class ExamSyncWorker {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly queuedRuns = new Map<string, QueuedRun>();
  private readonly ownerCancellationTails = new Map<string, Promise<void>>();
  private readonly ownerGenerations = new Map<string, number>();
  private readonly ownerControllers = new Map<string, Set<AbortController>>();

  public constructor(
    private readonly repository: SyncCommandStore,
    private readonly transport: ExamSyncTransport,
    private readonly options: ExamSyncWorkerOptions,
  ) {}

  public run(ownerId: string, sessionId: string | null = null): Promise<SyncRunResult> {
    const scope = this.scopeKey(ownerId, sessionId);
    if (this.ownerCancellationTails.has(ownerId)) {
      const queued = this.queuedRuns.get(scope);
      if (queued) return queued.promise;
      const promise = this.waitForOwnerCancellation(ownerId)
        .then(() => this.startRun(ownerId, sessionId))
        .finally(() => {
          if (this.queuedRuns.get(scope)?.promise === promise) this.queuedRuns.delete(scope);
        });
      this.queuedRuns.set(scope, { ownerId, promise });
      return promise;
    }
    return this.startRun(ownerId, sessionId);
  }

  public cancelOwner(ownerId: string): Promise<void> {
    this.ownerGenerations.set(ownerId, (this.ownerGenerations.get(ownerId) ?? 0) + 1);
    const interrupted = [...this.activeRuns.values()]
      .filter(({ ownerId: activeOwnerId }) => activeOwnerId === ownerId)
      .map(({ promise }) => promise);
    for (const controller of this.ownerControllers.get(ownerId) ?? []) controller.abort();

    const predecessor = this.ownerCancellationTails.get(ownerId);
    const operation = (predecessor
      ? predecessor.catch(() => undefined)
      : Promise.resolve()
    ).then(async () => {
      await Promise.allSettled(interrupted);
      try {
        await this.repository.releaseInterruptedCommands(ownerId, this.options.clock.now());
      } catch (error) {
        reportBackgroundErrorSafely(this.options.reportBackgroundError, error, {
          operation: 'release-interrupted-sync',
          ownerId,
        });
        throw error;
      }
    });
    const tail = operation.finally(() => {
      if (this.ownerCancellationTails.get(ownerId) === tail) {
        this.ownerCancellationTails.delete(ownerId);
      }
    });
    this.ownerCancellationTails.set(ownerId, tail);
    return tail;
  }

  private startRun(ownerId: string, sessionId: string | null): Promise<SyncRunResult> {
    const scope = this.scopeKey(ownerId, sessionId);
    const exact = this.activeRuns.get(scope);
    if (exact) return exact.promise;

    const generation = this.ownerGenerations.get(ownerId) ?? 0;
    const otherOwners = new Set(
      [...this.activeRuns.values()]
        .filter(({ ownerId: activeOwnerId }) => activeOwnerId !== ownerId)
        .map(({ ownerId: activeOwnerId }) => activeOwnerId),
    );
    const sameOwnerPredecessors = [...this.activeRuns.values()]
      .filter(({ ownerId: activeOwnerId }) => activeOwnerId === ownerId)
      .map(({ promise }) => promise);
    const promise = Promise.all([
      Promise.all([...otherOwners].map((activeOwnerId) => this.cancelOwner(activeOwnerId))),
      Promise.allSettled(sameOwnerPredecessors),
    ])
      .then(() => this.runBounded(ownerId, sessionId, generation))
      .finally(() => {
        if (this.activeRuns.get(scope)?.promise === promise) this.activeRuns.delete(scope);
      });
    this.activeRuns.set(scope, { ownerId, generation, promise });
    return promise;
  }

  private async waitForOwnerCancellation(ownerId: string): Promise<void> {
    while (true) {
      const tail = this.ownerCancellationTails.get(ownerId);
      if (!tail) return;
      await tail;
    }
  }

  private async runBounded(
    ownerId: string,
    sessionId: string | null,
    generation: number,
  ): Promise<SyncRunResult> {
    if (!this.isCurrent(ownerId, generation)) {
      return this.result(ZERO_COUNTS, false, true, false);
    }
    const maximumCommands = this.options.maximumCommandsPerRun ?? 20;
    const deadline = this.options.clock.now() + (this.options.timeBudgetMs ?? 10_000);
    const connectivity = await this.readConnectivity(ownerId, deadline);
    if (connectivity === 'aborted') {
      return this.result(
        ZERO_COUNTS,
        this.isCurrent(ownerId, generation),
        !this.isCurrent(ownerId, generation),
        false,
      );
    }
    if (!this.isCurrent(ownerId, generation)) {
      return this.result(ZERO_COUNTS, false, true, false);
    }
    if (connectivity === 'offline') {
      return this.result(ZERO_COUNTS, false, false, true);
    }

    const counters: RunCounters = { positions: 0, answers: 0, terminals: 0 };
    const processors = new CommandProcessors({
      ownerId,
      repository: this.repository,
      transport: this.transport,
      clock: this.options.clock,
      random: this.options.random,
      requestLease: () => this.requestLease(ownerId),
      isCurrent: () => this.isCurrent(ownerId, generation),
      ...(this.options.retryPolicy ? { retryPolicy: this.options.retryPolicy } : {}),
    });

    await this.drainPositions(ownerId, sessionId, generation, counters, processors, maximumCommands, deadline);
    await this.drainAnswers(ownerId, sessionId, generation, counters, processors, maximumCommands, deadline);
    await this.drainTerminals(ownerId, sessionId, generation, counters, processors, maximumCommands, deadline);

    return this.result(
      counters,
      this.total(counters) >= maximumCommands || this.options.clock.now() >= deadline,
      !this.isCurrent(ownerId, generation),
      false,
    );
  }

  private async drainPositions(
    ownerId: string,
    sessionId: string | null,
    generation: number,
    counters: RunCounters,
    processors: CommandProcessors,
    maximumCommands: number,
    deadline: number,
  ): Promise<void> {
    let progressed = true;
    while (progressed && this.canContinue(ownerId, generation, counters, maximumCommands, deadline)) {
      progressed = false;
      const due = await this.repository.listDuePositionCommands(
        ownerId,
        this.options.clock.now(),
        maximumCommands - this.total(counters),
        sessionId,
      );
      if (!this.isCurrent(ownerId, generation)) return;
      const heads = earliestPerSession(due, ({ positionCommandId }) => positionCommandId);
      for (const command of heads) {
        if (!this.canContinue(ownerId, generation, counters, maximumCommands, deadline)) return;
        const result = await processors.position(command);
        this.record(counters, 'positions', result);
        progressed = progressed || result.progressed;
      }
    }
  }

  private async drainAnswers(
    ownerId: string,
    sessionId: string | null,
    generation: number,
    counters: RunCounters,
    processors: CommandProcessors,
    maximumCommands: number,
    deadline: number,
  ): Promise<void> {
    let progressed = true;
    while (progressed && this.canContinue(ownerId, generation, counters, maximumCommands, deadline)) {
      progressed = false;
      const due = await this.repository.listDueAnswerCommands(
        ownerId,
        this.options.clock.now(),
        maximumCommands - this.total(counters),
        sessionId,
      );
      if (!this.isCurrent(ownerId, generation)) return;
      const heads = earliestPerSession(due, ({ clientAnswerId }) => clientAnswerId);
      for (const command of heads) {
        if (!this.canContinue(ownerId, generation, counters, maximumCommands, deadline)) return;
        const result = await processors.answer(command);
        this.record(counters, 'answers', result);
        progressed = progressed || result.progressed;
      }
    }
  }

  private async drainTerminals(
    ownerId: string,
    sessionId: string | null,
    generation: number,
    counters: RunCounters,
    processors: CommandProcessors,
    maximumCommands: number,
    deadline: number,
  ): Promise<void> {
    let progressed = true;
    while (progressed && this.canContinue(ownerId, generation, counters, maximumCommands, deadline)) {
      progressed = false;
      const due = await this.repository.listDueTerminalCommands(
        ownerId,
        this.options.clock.now(),
        maximumCommands - this.total(counters),
        sessionId,
      );
      if (!this.isCurrent(ownerId, generation)) return;
      const heads = earliestPerSession(due, ({ clientTerminalId }) => clientTerminalId);
      for (const command of heads) {
        if (!this.canContinue(ownerId, generation, counters, maximumCommands, deadline)) return;
        if (await this.repository.hasUnacknowledgedAnswers(ownerId, command.sessionId)) continue;
        if (!this.isCurrent(ownerId, generation)) return;
        const result = await processors.terminal(command);
        this.record(counters, 'terminals', result);
        progressed = progressed || result.progressed;
      }
    }
  }

  private async readConnectivity(
    ownerId: string,
    deadline: number,
  ): Promise<'online' | 'offline' | 'aborted'> {
    const remainingBudgetMs = Math.max(0, deadline - this.options.clock.now());
    if (remainingBudgetMs === 0) return 'aborted';
    const lease = this.requestLease(
      ownerId,
      Math.min(this.options.requestTimeoutMs ?? 15_000, remainingBudgetMs),
    );
    try {
      return await probeConnectivity(this.options.connectivity, lease.signal);
    } finally {
      lease.release();
    }
  }

  private requestLease(
    ownerId: string,
    timeoutMs = this.options.requestTimeoutMs ?? 15_000,
  ): RequestLease {
    const controller = new AbortController();
    const controllers = this.ownerControllers.get(ownerId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.ownerControllers.set(ownerId, controllers);
    const cancelTimeout = this.options.clock.schedule(timeoutMs, () => controller.abort());
    return {
      signal: controller.signal,
      release: () => {
        cancelTimeout();
        controllers.delete(controller);
        if (controllers.size === 0) this.ownerControllers.delete(ownerId);
      },
    };
  }

  private canContinue(
    ownerId: string,
    generation: number,
    counters: RunCounters,
    maximumCommands: number,
    deadline: number,
  ): boolean {
    return (
      this.isCurrent(ownerId, generation) &&
      this.total(counters) < maximumCommands &&
      this.options.clock.now() < deadline
    );
  }

  private isCurrent(ownerId: string, generation: number): boolean {
    return (this.ownerGenerations.get(ownerId) ?? 0) === generation;
  }

  private record(
    counters: RunCounters,
    field: keyof RunCounters,
    result: ProcessorResult,
  ): void {
    if (result.attempted) counters[field] += 1;
  }

  private total(counters: Readonly<RunCounters>): number {
    return counters.positions + counters.answers + counters.terminals;
  }

  private result(
    counters: Readonly<RunCounters>,
    stoppedByBudget: boolean,
    cancelled: boolean,
    offline: boolean,
  ): SyncRunResult {
    return {
      processedPositions: counters.positions,
      processedAnswers: counters.answers,
      processedTerminals: counters.terminals,
      stoppedByBudget,
      cancelled,
      offline,
    };
  }

  private scopeKey(ownerId: string, sessionId: string | null): string {
    return `${ownerId}:${sessionId ?? '*'}`;
  }
}
