import { describe, expect, it } from 'vitest';

import {
  DashboardDataError,
  validateSnapshot,
  type DashboardSnapshot,
  type DashboardStats,
} from '../src/domain/contracts.js';
import {
  DEMO_DASHBOARD_SNAPSHOT,
  FixtureDashboardDataSource,
  type FixtureScheduler,
} from '../src/demo/fixture-data-source.js';

function withStats(stats: Partial<DashboardStats>): DashboardSnapshot {
  return {
    ...DEMO_DASHBOARD_SNAPSHOT,
    summary: {
      ...DEMO_DASHBOARD_SNAPSHOT.summary,
      stats: { ...DEMO_DASHBOARD_SNAPSHOT.summary.stats, ...stats },
    },
  };
}

describe('public dashboard contract', () => {
  it('accepts the deterministic public fixture', () => {
    expect(validateSnapshot(DEMO_DASHBOARD_SNAPSHOT)).toBe(DEMO_DASHBOARD_SNAPSHOT);
    expect(DEMO_DASHBOARD_SNAPSHOT.summary.profile).toEqual({ displayName: 'Demo' });
    expect(DEMO_DASHBOARD_SNAPSHOT.summary.generatedAt).toBe('2026-08-01T09:00:00.000Z');
  });

  it.each([-1, 100.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an out-of-range average score: %s',
    (averageScorePercent) => {
      expect(() => validateSnapshot(withStats({ averageScorePercent }))).toThrowError(
        DashboardDataError,
      );
    },
  );

  it('rejects correct-answer counts larger than answered counts', () => {
    expect(() =>
      validateSnapshot(withStats({ answeredQuestions: 10, correctAnswers: 11 })),
    ).toThrow('correctAnswers cannot exceed answeredQuestions');
  });

  it.each([
    ['completedTests', { completedTests: -1 }],
    ['answeredQuestions', { answeredQuestions: 1.5 }],
    ['correctAnswers', { correctAnswers: Number.MAX_SAFE_INTEGER + 1 }],
  ] as const)('rejects an invalid %s count', (_field, stats) => {
    expect(() => validateSnapshot(withStats(stats))).toThrow('non-negative integer');
  });

  it.each([
    ['number', { number: 1.25 }],
    ['questionCount', { questionCount: -1 }],
    ['attemptCount', { attemptCount: Number.NaN }],
  ] as const)('rejects an invalid ticket %s', (_field, override) => {
    const firstTicket = DEMO_DASHBOARD_SNAPSHOT.catalog.tickets[0];
    expect(firstTicket).toBeDefined();
    if (!firstTicket) return;
    const snapshot: DashboardSnapshot = {
      ...DEMO_DASHBOARD_SNAPSHOT,
      catalog: {
        ...DEMO_DASHBOARD_SNAPSHOT.catalog,
        tickets: [{ ...firstTicket, ...override }],
      },
    };
    expect(() => validateSnapshot(snapshot)).toThrow('non-negative integer');
  });

  it('rejects an invalid catalog total', () => {
    const snapshot: DashboardSnapshot = {
      ...DEMO_DASHBOARD_SNAPSHOT,
      catalog: { ...DEMO_DASHBOARD_SNAPSHOT.catalog, totalQuestions: -120 },
    };
    expect(() => validateSnapshot(snapshot)).toThrow('catalog.totalQuestions');
  });

  it('rejects a fractional result question count', () => {
    const firstResult = DEMO_DASHBOARD_SNAPSHOT.summary.recentResults[0];
    expect(firstResult).toBeDefined();
    if (!firstResult) return;
    const snapshot: DashboardSnapshot = {
      ...DEMO_DASHBOARD_SNAPSHOT,
      summary: {
        ...DEMO_DASHBOARD_SNAPSHOT.summary,
        recentResults: [{ ...firstResult, questionCount: 19.5 }],
      },
    };
    expect(() => validateSnapshot(snapshot)).toThrow('recentResult.questionCount');
  });

  it.each([
    '2026-08-01',
    '2026-08-01T09:00:00Z',
    '2026-08-01T11:00:00.000+02:00',
    '2026-02-30T09:00:00.000Z',
    '2025-02-29T09:00:00.000Z',
    '2026-13-01T09:00:00.000Z',
    '2026-01-01T24:00:00.000Z',
    'not-a-date',
  ])(
    'requires canonical, semantically valid UTC timestamps: %s',
    (generatedAt) => {
      const snapshot: DashboardSnapshot = {
        ...DEMO_DASHBOARD_SNAPSHOT,
        summary: { ...DEMO_DASHBOARD_SNAPSHOT.summary, generatedAt },
      };
      expect(() => validateSnapshot(snapshot)).toThrow('canonical UTC timestamp');
    },
  );

  it('accepts a canonical timestamp on a real leap day', () => {
    const snapshot: DashboardSnapshot = {
      ...DEMO_DASHBOARD_SNAPSHOT,
      summary: {
        ...DEMO_DASHBOARD_SNAPSHOT.summary,
        generatedAt: '2024-02-29T23:59:59.999Z',
      },
    };
    expect(validateSnapshot(snapshot)).toBe(snapshot);
  });

  it('rejects a blank public identity', () => {
    const unsafe = {
      ...DEMO_DASHBOARD_SNAPSHOT,
      summary: {
        ...DEMO_DASHBOARD_SNAPSHOT.summary,
        profile: { displayName: '' },
      },
    };
    expect(() => validateSnapshot(unsafe as unknown as DashboardSnapshot)).toThrow(
      'Public profile identity must be Demo',
    );
  });

  it('rejects repeated identifiers across results and tickets', () => {
    const firstResult = DEMO_DASHBOARD_SNAPSHOT.summary.recentResults[0];
    const firstTicket = DEMO_DASHBOARD_SNAPSHOT.catalog.tickets[0];
    expect(firstResult).toBeDefined();
    expect(firstTicket).toBeDefined();
    if (!firstResult || !firstTicket) return;
    const snapshot: DashboardSnapshot = {
      ...DEMO_DASHBOARD_SNAPSHOT,
      catalog: {
        ...DEMO_DASHBOARD_SNAPSHOT.catalog,
        tickets: [{ ...firstTicket, id: firstResult.id }],
      },
    };
    expect(() => validateSnapshot(snapshot)).toThrow('Fixture identifiers must be unique');
  });
});

describe('fixture dashboard data source', () => {
  it('returns a fresh validated graph without sharing nested arrays', async () => {
    const source = new FixtureDashboardDataSource();
    const first = await source.load(new AbortController().signal);
    const second = await source.load(new AbortController().signal);

    expect(first).toEqual(DEMO_DASHBOARD_SNAPSHOT);
    expect(first).not.toBe(DEMO_DASHBOARD_SNAPSHOT);
    expect(first.summary.stats).not.toBe(DEMO_DASHBOARD_SNAPSHOT.summary.stats);
    expect(first.summary.recentResults).not.toBe(second.summary.recentResults);
    expect(first.catalog.tickets).not.toBe(second.catalog.tickets);
  });

  it('honors cancellation before returning fixture data', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new FixtureDashboardDataSource().load(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('checks cancellation again after an asynchronous scheduler resumes', async () => {
    let release: (() => void) | undefined;
    const scheduler: FixtureScheduler = {
      wait: () => new Promise<void>((resolve) => (release = resolve)),
    };
    const controller = new AbortController();
    const result = new FixtureDashboardDataSource(DEMO_DASHBOARD_SNAPSHOT, scheduler).load(
      controller.signal,
    );
    controller.abort();
    release?.();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
