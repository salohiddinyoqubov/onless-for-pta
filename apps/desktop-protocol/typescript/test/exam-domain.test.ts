import { describe, expect, it } from 'vitest';

import {
  examResultSchema,
  examSessionSchema,
  parseExamResult,
  parseExamSession,
  sessionProgress,
  toExamResultWire,
  toExamSessionWire,
  type ExamResult,
  type ExamSession,
} from '../src/index.js';

function sessionBuilder(overrides: Partial<ExamSession> = {}): Record<string, unknown> {
  return {
    sessionId: '00000000-0000-4000-8000-000000000010',
    mode: 'training',
    locale: 'uz',
    questionCount: 20,
    durationMinutes: 25,
    currentQuestionIndex: 4,
    answeredQuestionCount: 4,
    elapsedSeconds: 300,
    status: 'active',
    startedAt: '2026-02-01T08:00:00.000Z',
    completedAt: null,
    revision: 5,
    ...overrides,
  };
}

function resultBuilder(overrides: Partial<ExamResult> = {}): Record<string, unknown> {
  return {
    sessionId: '00000000-0000-4000-8000-000000000010',
    mode: 'training',
    locale: 'uz',
    totalQuestions: 20,
    answeredQuestions: 18,
    correctCount: 15,
    incorrectCount: 3,
    elapsedSeconds: 1200,
    completedAt: '2026-02-01T08:20:00.000Z',
    ...overrides,
  };
}

describe('exam session invariants', () => {
  it('accepts each lifecycle state when its timestamps are coherent', () => {
    expect(
      parseExamSession(
        sessionBuilder({
          status: 'draft',
          currentQuestionIndex: 0,
          answeredQuestionCount: 0,
          elapsedSeconds: 0,
          startedAt: null,
          revision: 0,
        }),
      ).status,
    ).toBe('draft');
    expect(parseExamSession(sessionBuilder()).status).toBe('active');
    expect(parseExamSession(sessionBuilder({ status: 'paused' })).status).toBe('paused');
    expect(
      parseExamSession(
        sessionBuilder({
          status: 'completed',
          completedAt: '2026-02-01T08:20:00.000Z',
        }),
      ).status,
    ).toBe('completed');
    expect(
      parseExamSession(
        sessionBuilder({
          status: 'cancelled',
          completedAt: '2026-02-01T08:10:00.000Z',
        }),
      ).status,
    ).toBe('cancelled');
  });

  it('requires lifecycle timestamps for started and terminal states', () => {
    expect(() => parseExamSession(sessionBuilder({ startedAt: null }))).toThrow();
    expect(() =>
      parseExamSession(sessionBuilder({ status: 'completed', completedAt: null })),
    ).toThrow();
    expect(() =>
      parseExamSession(
        sessionBuilder({ status: 'active', completedAt: '2026-02-01T08:10:00.000Z' }),
      ),
    ).toThrow();
  });

  it('rejects a terminal timestamp before the start', () => {
    expect(() =>
      parseExamSession(
        sessionBuilder({
          status: 'completed',
          completedAt: '2026-02-01T07:59:59.999Z',
        }),
      ),
    ).toThrow(/precede/);
  });

  it('rejects unsafe numeric values without coercion', () => {
    for (const [field, value] of [
      ['questionCount', 1.5],
      ['durationMinutes', Number.NaN],
      ['currentQuestionIndex', -1],
      ['answeredQuestionCount', Number.POSITIVE_INFINITY],
      ['elapsedSeconds', '300'],
      ['revision', -1],
    ] as const) {
      expect(() => parseExamSession({ ...sessionBuilder(), [field]: value })).toThrow();
    }
  });

  it('prevents progress from advancing past the visible question', () => {
    expect(() =>
      parseExamSession(
        sessionBuilder({ currentQuestionIndex: 4, answeredQuestionCount: 6 }),
      ),
    ).toThrow(/current question/);
    expect(
      parseExamSession(
        sessionBuilder({ currentQuestionIndex: 4, answeredQuestionCount: 5 }),
      ).answeredQuestionCount,
    ).toBe(5);
  });

  it('calculates bounded progress without mutating the session', () => {
    const session = parseExamSession(sessionBuilder());
    expect(sessionProgress(session)).toEqual({
      answered: 4,
      unanswered: 16,
      elapsedSeconds: 300,
      remainingSeconds: 1200,
      completionRatio: 0.2,
    });
    expect(session).toEqual(parseExamSession(sessionBuilder()));
  });

  it('preserves validation issues through safeParse', () => {
    const result = examSessionSchema.safeParse(
      sessionBuilder({ currentQuestionIndex: 20, answeredQuestionCount: 21 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(['currentQuestionIndex', 'answeredQuestionCount']),
      );
    }
  });

  it('does not expose student identity, answer content, or pass state', () => {
    const wire = toExamSessionWire(parseExamSession(sessionBuilder()));
    expect(wire).not.toHaveProperty('answers');
    expect(wire).not.toHaveProperty('passed');
  });
});

describe('exam result invariants', () => {
  it('accepts a partial training result without deriving a pass decision', () => {
    const result = parseExamResult(resultBuilder());
    expect(result.answeredQuestions).toBe(18);
    expect(result).not.toHaveProperty('passed');
    expect(toExamResultWire(result)).not.toHaveProperty('passed');
  });

  it('requires correct and incorrect counts to reconcile exactly', () => {
    expect(() => parseExamResult(resultBuilder({ correctCount: 14 }))).toThrow(/must equal/);
    expect(() => parseExamResult(resultBuilder({ incorrectCount: 4 }))).toThrow(/must equal/);
  });

  it('does not allow answered count or duration to exceed mode bounds', () => {
    expect(() => parseExamResult(resultBuilder({ answeredQuestions: 21 }))).toThrow();
    expect(() => parseExamResult(resultBuilder({ elapsedSeconds: 10_801 }))).toThrow();
    expect(() => parseExamResult(resultBuilder({ totalQuestions: 101 }))).toThrow();
  });

  it('applies fixed public exam bounds to results', () => {
    expect(() =>
      parseExamResult(
        resultBuilder({
          mode: 'exam',
          totalQuestions: 19,
          answeredQuestions: 18,
          correctCount: 15,
          incorrectCount: 3,
        }),
      ),
    ).toThrow(/outside mode bounds/);
    expect(
      parseExamResult(
        resultBuilder({
          mode: 'exam',
          totalQuestions: 20,
          elapsedSeconds: 1500,
        }),
      ).mode,
    ).toBe('exam');
  });

  it('collects multiple result violations in one validation pass', () => {
    const result = examResultSchema.safeParse(
      resultBuilder({ answeredQuestions: 21, correctCount: 22, elapsedSeconds: 11_000 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('rejects unrecognized properties rather than silently dropping them', () => {
    expect(() => parseExamResult({ ...resultBuilder(), passThreshold: 0.7 })).toThrow();
    expect(() => parseExamSession({ ...sessionBuilder(), questionIds: ['private'] })).toThrow();
  });
});
