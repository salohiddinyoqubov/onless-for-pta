import { describe, expect, it } from 'vitest';

import {
  buildReviewPageViewModel,
  getReviewHeaderPresentation,
  isSafeReviewMediaPath,
  parseReviewSnapshot,
  ReviewSnapshotValidationError,
} from '../src/review/snapshot-contract';
import type { ReviewMode } from '../src/review/types';
import {
  answeredQuestionFixture,
  EXPECTED_REVIEW,
  IDS,
  requiredItem,
  reviewSnapshotFixture,
  unansweredQuestionFixture,
} from './review-fixtures';

function boundary(overrides: Readonly<Record<string, unknown>>): unknown {
  return { ...reviewSnapshotFixture(), ...overrides };
}

describe('review snapshot boundary', () => {
  it('normalizes a valid terminal snapshot into immutable data', () => {
    const parsed = parseReviewSnapshot(reviewSnapshotFixture(), EXPECTED_REVIEW);

    expect(parsed.session_id).toBe(IDS.session);
    expect(parsed.questions).toHaveLength(2);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.questions)).toBe(true);
    expect(Object.isFrozen(parsed.questions[0]?.answers)).toBe(true);
  });

  it.each(['COMPLETED', 'FAILED', 'EXPIRED'] as const)(
    'accepts terminal status %s',
    (status) => {
      expect(
        parseReviewSnapshot(reviewSnapshotFixture({ status }), EXPECTED_REVIEW)
          .status,
      ).toBe(status);
    },
  );

  it.each([
    ['training', 'training', null],
    ['exam', 'exam', null],
    ['category', 'category', null],
    ['demo', 'demo', null],
    ['grand_mock', 'grand_mock', null],
    ['insight', 'insight', null],
    ['daily', 'category', 'daily'],
    ['incorrect', 'category', 'incorrect'],
    ['saved', 'category', 'saved'],
    ['checkpoint', 'category', 'checkpoint'],
    ['sign', 'category', 'sign'],
    ['telegram_quiz', 'category', 'telegram_quiz'],
    ['extension', 'category', 'extension'],
  ] satisfies readonly (readonly [ReviewMode, string, ReviewMode | null])[])(
    'maps %s to the public header presentation',
    (mode, headerMode, labelMode) => {
      expect(getReviewHeaderPresentation(mode)).toEqual({
        mode: headerMode,
        labelMode,
      });
    },
  );

  it.each([
    'toString',
    'constructor',
    '__proto__',
    'unknown',
    '',
    null,
    undefined,
    7,
    {},
  ])('rejects unsupported header mode %j', (mode) => {
    expect(() => getReviewHeaderPresentation(mode)).toThrow(
      'unsupported review header mode',
    );
  });

  it.each([
    null,
    [],
    'snapshot',
    1,
    Object.create({ inherited: true }) as object,
  ])('rejects non-plain snapshot %j', (value) => {
    expect(() => parseReviewSnapshot(value, EXPECTED_REVIEW)).toThrow(
      ReviewSnapshotValidationError,
    );
  });

  it('rejects an unexpected top-level field', () => {
    expect(() =>
      parseReviewSnapshot(boundary({ debug_payload: true }), EXPECTED_REVIEW),
    ).toThrow('unsupported field: debug_payload');
  });

  it.each([
    ['session mismatch', {}, { sessionId: '40000000-0000-4000-8000-000000000099', locale: 'uz' }],
    ['locale mismatch', {}, { sessionId: IDS.session, locale: 'ru' }],
    ['malformed expectation', {}, { sessionId: 'bad', locale: 'uz' }],
  ] as const)('rejects %s', (_label, overrides, expected) => {
    expect(() =>
      parseReviewSnapshot(boundary(overrides), expected),
    ).toThrow('does not match');
  });

  it.each([
    ['session_id', 'not-a-uuid', 'must be a UUID'],
    ['revision', -1, 'greater than or equal to 0'],
    ['status', 'RUNNING', 'not reviewable'],
    ['mode', 'battle', 'unsupported'],
    ['locale', 'en', 'unsupported'],
    ['review_kind', 'internal', 'unsupported'],
    ['exam_id', 'bad-id', 'must be a UUID'],
    ['ticket_id', 'bad-id', 'must be a UUID'],
    ['ticket_number', 0, 'greater than or equal to 1'],
    ['started_at', 'yesterday', 'canonical UTC RFC3339'],
    ['completed_at', 'tomorrow-ish', 'canonical UTC RFC3339'],
    ['time_taken_seconds', -1, 'greater than or equal to 0'],
    ['total_questions', -1, 'greater than or equal to 0'],
    ['score_percentage', '50', 'finite number'],
    ['score_percentage', Number.NaN, 'finite number'],
    ['score_percentage', 101, 'between 0 and 100'],
    ['has_passed', 'yes', 'must be boolean'],
    ['questions', null, 'must be an array'],
  ] as const)('rejects malformed %s', (field, value, message) => {
    expect(() =>
      parseReviewSnapshot(boundary({ [field]: value }), EXPECTED_REVIEW),
    ).toThrow(message);
  });

  it.each([
    { total_answered: 2 },
    { correct_count: 0 },
    { incorrect_count: 1 },
    { unanswered_count: 0 },
    { total_questions: 3 },
  ])('rejects inconsistent summary counts: %o', (overrides) => {
    expect(() =>
      parseReviewSnapshot(boundary(overrides), EXPECTED_REVIEW),
    ).toThrow('summary counts are inconsistent');
  });

  it('accepts a real leap day in canonical UTC form', () => {
    const parsed = parseReviewSnapshot(
      reviewSnapshotFixture({
        started_at: '2024-02-29T23:59:59.999Z',
        completed_at: '2024-03-01T00:00:00.000Z',
      }),
      EXPECTED_REVIEW,
    );
    expect(parsed.started_at).toBe('2024-02-29T23:59:59.999Z');
  });

  it.each([
    ['locale date', '01/10/2026 10:00:00'],
    ['date only', '2026-01-10'],
    ['missing timezone', '2026-01-10T10:00:00.000'],
    ['numeric UTC offset', '2026-01-10T10:00:00.000+00:00'],
    ['lowercase separators', '2026-01-10t10:00:00.000z'],
    ['missing milliseconds', '2026-01-10T10:00:00Z'],
    ['four fractional digits', '2026-01-10T10:00:00.0000Z'],
    ['edge whitespace', ' 2026-01-10T10:00:00.000Z'],
  ])('rejects non-canonical timestamp: %s', (_label, timestamp) => {
    expect(() =>
      parseReviewSnapshot(
        reviewSnapshotFixture({ started_at: timestamp }),
        EXPECTED_REVIEW,
      ),
    ).toThrow('canonical UTC RFC3339');
  });

  it.each([
    ['impossible February day', '2026-02-30T10:00:00.000Z'],
    ['non-leap February 29', '2025-02-29T10:00:00.000Z'],
    ['April 31', '2026-04-31T10:00:00.000Z'],
    ['month 13', '2026-13-01T10:00:00.000Z'],
    ['hour 24', '2026-01-10T24:00:00.000Z'],
    ['minute 60', '2026-01-10T10:60:00.000Z'],
    ['second 60', '2026-01-10T10:00:60.000Z'],
    ['year zero', '0000-01-10T10:00:00.000Z'],
  ])('rejects invalid calendar timestamp: %s', (_label, timestamp) => {
    expect(() =>
      parseReviewSnapshot(
        reviewSnapshotFixture({ started_at: timestamp }),
        EXPECTED_REVIEW,
      ),
    ).toThrow('not a valid calendar date-time');
  });

  it('accepts an empty Grand Mock summary', () => {
    const summary = reviewSnapshotFixture({
      mode: 'grand_mock',
      review_kind: 'summary_only',
      total_questions: 0,
      total_answered: 0,
      correct_count: 0,
      incorrect_count: 0,
      unanswered_count: 0,
      score_percentage: 0,
      questions: [],
    });

    expect(parseReviewSnapshot(summary, EXPECTED_REVIEW).questions).toEqual([]);
  });

  it.each([
    ['summary with questions', { review_kind: 'summary_only' }],
    [
      'summary outside Grand Mock',
      {
        review_kind: 'summary_only',
        questions: [],
        total_questions: 0,
        total_answered: 0,
        correct_count: 0,
        unanswered_count: 0,
        score_percentage: 0,
      },
    ],
    ['Grand Mock question detail', { mode: 'grand_mock' }],
    ['missing question detail', { total_questions: 3, unanswered_count: 2 }],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(() =>
      parseReviewSnapshot(boundary(overrides), EXPECTED_REVIEW),
    ).toThrow();
  });
});

describe('review question validation', () => {
  it.each([
    ['non-sequential position', { position: 3 }, 'positions'],
    ['empty question text', { text: ' ' }, 'non-empty'],
    ['bad question id', { question_id: 'q-1' }, 'UUID'],
    ['bad ticket position', { ticket_position: 0 }, 'greater than or equal to 1'],
    ['bad ticket number', { ticket_number: -2 }, 'greater than or equal to 1'],
    ['bad elapsed time', { time_spent_seconds: -1 }, 'greater than or equal to 0'],
    ['non-array answers', { answers: null }, 'at least two'],
    ['single answer', { answers: [answeredQuestionFixture().answers[0]] }, 'at least two'],
    ['unknown field', { internal_score: 9 }, 'unsupported field'],
  ] as const)('rejects %s', (_label, questionOverrides, message) => {
    const question = { ...answeredQuestionFixture(), ...questionOverrides };
    expect(() =>
      buildReviewPageViewModel(
        boundary({ questions: [question, unansweredQuestionFixture()] }),
        EXPECTED_REVIEW,
      ),
    ).toThrow(message);
  });

  it('allows explicit Uzbek text fallback for Russian review content', () => {
    const questions = [
      answeredQuestionFixture({
        text_locale: 'uz',
        answers: answeredQuestionFixture().answers.map((answer) => ({
          ...answer,
          text_locale: 'uz',
        })),
      }),
    ];
    const russian = reviewSnapshotFixture({
      locale: 'ru',
      total_questions: 1,
      total_answered: 1,
      correct_count: 1,
      unanswered_count: 0,
      score_percentage: 100,
      has_passed: true,
      questions,
    });

    expect(
      parseReviewSnapshot(russian, { sessionId: IDS.session, locale: 'ru' })
        .questions[0]?.text_locale,
    ).toBe('uz');
  });

  it('rejects unrelated text locales', () => {
    const question = answeredQuestionFixture({ text_locale: 'ru' });
    expect(() =>
      parseReviewSnapshot(
        boundary({ questions: [question, unansweredQuestionFixture()] }),
        EXPECTED_REVIEW,
      ),
    ).toThrow('text_locale is inconsistent');
  });

  it.each([
    ['/media/demo.webp', true],
    ['/assets/demo/video.webm', true],
    ['https://example.test/demo.webp', false],
    ['http://127.0.0.1/demo.webp', false],
    ['//example.test/demo.webp', false],
    ['/media/../private.webp', false],
    ['/media/%2e%2e/private.webp', false],
    ['/media/demo.webp?token=x', false],
    ['/media/demo.webp#fragment', false],
    ['\\media\\demo.webp', false],
    ['not-a-path', false],
  ])('classifies media path %s', (path, expected) => {
    expect(isSafeReviewMediaPath(path)).toBe(expected);
  });

  it.each([
    ['image_url', 'https://example.test/image.webp', 'safe root-relative'],
    ['video_url', '/media/../video.webm', 'safe root-relative'],
    ['image_url', 42, 'non-empty string'],
  ] as const)('rejects unsafe %s', (field, value, message) => {
    const question = { ...answeredQuestionFixture(), [field]: value };
    expect(() =>
      parseReviewSnapshot(
        boundary({ questions: [question, unansweredQuestionFixture()] }),
        EXPECTED_REVIEW,
      ),
    ).toThrow(message);
  });

  it('rejects duplicate question IDs', () => {
    expect(() =>
      buildReviewPageViewModel(
        boundary({
          questions: [
            answeredQuestionFixture(),
            unansweredQuestionFixture({ question_id: IDS.questionOne }),
          ],
        }),
        EXPECTED_REVIEW,
      ),
    ).toThrow('duplicate question_id');
  });

  it('rejects an answer ID reused by another question', () => {
    const duplicate = unansweredQuestionFixture({
      answers: [
        {
          ...requiredItem(unansweredQuestionFixture().answers, 0),
          answer_id: IDS.answerOne,
        },
        requiredItem(unansweredQuestionFixture().answers, 1),
      ],
    });
    expect(() =>
      buildReviewPageViewModel(
        boundary({ questions: [answeredQuestionFixture(), duplicate] }),
        EXPECTED_REVIEW,
      ),
    ).toThrow('duplicate answer_id');
  });

  it('rejects non-increasing answer display order', () => {
    const base = answeredQuestionFixture();
    const question = answeredQuestionFixture({
      answers: [
        requiredItem(base.answers, 0),
        { ...requiredItem(base.answers, 1), display_order: 1 },
      ],
    });
    expect(() =>
      buildReviewPageViewModel(
        boundary({ questions: [question, unansweredQuestionFixture()] }),
        EXPECTED_REVIEW,
      ),
    ).toThrow('strictly increasing');
  });

  it.each([
    [
      'correct ID is not marked',
      answeredQuestionFixture({ correct_answer_id: IDS.answerTwo }),
      'conflicts',
    ],
    [
      'two correct markers',
      answeredQuestionFixture({
        answers: answeredQuestionFixture().answers.map((answer) => ({
          ...answer,
          is_correct: true,
        })),
      }),
      'exactly one',
    ],
    [
      'selected ID is not marked',
      answeredQuestionFixture({ selected_answer_id: IDS.answerTwo }),
      'inconsistent selected',
    ],
    [
      'answer result disagrees with IDs',
      answeredQuestionFixture({ is_correct: false }),
      'inconsistent selected',
    ],
    [
      'unanswered item has selected ID',
      unansweredQuestionFixture({ selected_answer_id: IDS.answerThree }),
      'selected outcome',
    ],
    [
      'unanswered item has boolean result',
      unansweredQuestionFixture({ is_correct: false }),
      'selected outcome',
    ],
  ] as const)('rejects %s', (_label, question, message) => {
    const second = question.position === 1
      ? unansweredQuestionFixture()
      : question;
    const first = question.position === 1
      ? question
      : answeredQuestionFixture();
    expect(() =>
      buildReviewPageViewModel(
        boundary({ questions: [first, second] }),
        EXPECTED_REVIEW,
      ),
    ).toThrow(message);
  });
});

describe('review view-model projection', () => {
  it('maps wire answer IDs to stable presentation option IDs', () => {
    const model = buildReviewPageViewModel(
      reviewSnapshotFixture(),
      EXPECTED_REVIEW,
    );

    expect(model.loadedKey).toBe(`${IDS.session}:uz`);
    expect(model.questions[0]).toMatchObject({
      correctOptionId: 'F1',
      correctOptionText: 'Sintetik javob A',
      selectedOptionId: 'F1',
      selectedOptionText: 'Sintetik javob A',
      isCorrect: true,
    });
    expect(model.questions[1]).not.toHaveProperty('selectedOptionId');
    expect(Object.isFrozen(model.questions)).toBe(true);
  });

  it('rejects outcomes that disagree with summary counts', () => {
    const incorrect = answeredQuestionFixture({
      answers: [
        {
          ...requiredItem(answeredQuestionFixture().answers, 0),
          is_selected: false,
        },
        {
          ...requiredItem(answeredQuestionFixture().answers, 1),
          is_selected: true,
        },
      ],
      selected_answer_id: IDS.answerTwo,
      is_correct: false,
    });
    expect(() =>
      buildReviewPageViewModel(
        boundary({ questions: [incorrect, unansweredQuestionFixture()] }),
        EXPECTED_REVIEW,
      ),
    ).toThrow('outcomes do not match');
  });
});
