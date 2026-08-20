import { describe, expect, it } from 'vitest';

import {
  parseReviewSnapshot,
  REVIEW_SNAPSHOT_BUDGETS,
} from '../src/review/snapshot-contract';
import type {
  ReviewAnswerSnapshot,
  ReviewQuestionSnapshot,
} from '../src/review/types';
import {
  answerFixture,
  answeredQuestionFixture,
  EXPECTED_REVIEW,
  IDS,
  reviewSnapshotFixture,
  unansweredQuestionFixture,
} from './review-fixtures';

function uuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function validAnswerSet(size: number): readonly ReviewAnswerSnapshot[] {
  return Array.from({ length: size }, (_, index) =>
    answerFixture({
      answer_id: uuid('50000000', index + 1),
      display_order: index + 1,
      text: `Synthetic answer ${String(index + 1)}`,
      is_selected: index === 0,
      is_correct: index === 0,
    }),
  );
}

function validQuestion(index: number): ReviewQuestionSnapshot {
  const correctAnswerId = uuid('52000000', index + 1);
  return answeredQuestionFixture({
    question_id: uuid('51000000', index + 1),
    position: index + 1,
    text: `Synthetic question ${String(index + 1)}`,
    answers: [
      answerFixture({
        answer_id: correctAnswerId,
        text: 'Correct synthetic answer',
      }),
      answerFixture({
        answer_id: uuid('53000000', index + 1),
        display_order: 2,
        text: 'Alternative synthetic answer',
        is_selected: false,
        is_correct: false,
      }),
    ],
    correct_answer_id: correctAnswerId,
    selected_answer_id: correctAnswerId,
  });
}

describe('untrusted review snapshot budgets', () => {
  it('publishes stable generic limits', () => {
    expect(REVIEW_SNAPSHOT_BUDGETS).toEqual({
      maxQuestions: 100,
      maxAnswersPerQuestion: 10,
      maxQuestionTextLength: 2_000,
      maxAnswerTextLength: 1_000,
      maxMediaKeyLength: 256,
      maxMediaPathLength: 2_048,
      maxTotalTextLength: 200_000,
    });
    expect(Object.isFrozen(REVIEW_SNAPSHOT_BUDGETS)).toBe(true);
  });

  it('accepts the maximum question count when the payload is otherwise valid', () => {
    const questions = Array.from(
      { length: REVIEW_SNAPSHOT_BUDGETS.maxQuestions },
      (_, index) => validQuestion(index),
    );
    const parsed = parseReviewSnapshot(
      reviewSnapshotFixture({
        total_questions: questions.length,
        total_answered: questions.length,
        correct_count: questions.length,
        unanswered_count: 0,
        score_percentage: 100,
        has_passed: true,
        questions,
      }),
      EXPECTED_REVIEW,
    );
    expect(parsed.questions).toHaveLength(REVIEW_SNAPSHOT_BUDGETS.maxQuestions);
  });

  it('rejects question arrays before traversing oversized content', () => {
    const questions = Array.from(
      { length: REVIEW_SNAPSHOT_BUDGETS.maxQuestions + 1 },
      () => null,
    );
    expect(() =>
      parseReviewSnapshot(
        { ...reviewSnapshotFixture(), questions },
        EXPECTED_REVIEW,
      ),
    ).toThrow('question budget');
  });

  it('accepts the maximum answer count', () => {
    const answers = validAnswerSet(REVIEW_SNAPSHOT_BUDGETS.maxAnswersPerQuestion);
    const question = answeredQuestionFixture({
      answers,
      correct_answer_id: answers[0]?.answer_id ?? IDS.answerOne,
      selected_answer_id: answers[0]?.answer_id ?? IDS.answerOne,
    });
    const parsed = parseReviewSnapshot(
      reviewSnapshotFixture({
        total_questions: 1,
        total_answered: 1,
        correct_count: 1,
        unanswered_count: 0,
        score_percentage: 100,
        has_passed: true,
        questions: [question],
      }),
      EXPECTED_REVIEW,
    );
    expect(parsed.questions[0]?.answers).toHaveLength(
      REVIEW_SNAPSHOT_BUDGETS.maxAnswersPerQuestion,
    );
  });

  it('rejects answer arrays before parsing their entries', () => {
    const question = {
      ...answeredQuestionFixture(),
      answers: Array.from(
        { length: REVIEW_SNAPSHOT_BUDGETS.maxAnswersPerQuestion + 1 },
        () => null,
      ),
    };
    expect(() =>
      parseReviewSnapshot(
        {
          ...reviewSnapshotFixture(),
          questions: [question, unansweredQuestionFixture()],
        },
        EXPECTED_REVIEW,
      ),
    ).toThrow('answer budget');
  });

  it.each([
    [
      'question text',
      answeredQuestionFixture({
        text: 'q'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxQuestionTextLength + 1),
      }),
      'character budget',
    ],
    [
      'answer text',
      answeredQuestionFixture({
        answers: [
          answerFixture({
            text: 'a'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxAnswerTextLength + 1),
          }),
          answerFixture({
            answer_id: IDS.answerTwo,
            display_order: 2,
            is_selected: false,
            is_correct: false,
          }),
        ],
      }),
      'character budget',
    ],
    [
      'image key',
      answeredQuestionFixture({
        image_key: 'k'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxMediaKeyLength + 1),
      }),
      'character budget',
    ],
    [
      'video key',
      answeredQuestionFixture({
        video_key: 'k'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxMediaKeyLength + 1),
      }),
      'character budget',
    ],
    [
      'image path',
      answeredQuestionFixture({
        image_url: `/${'p'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxMediaPathLength)}`,
      }),
      'character budget',
    ],
  ] as const)('rejects over-budget %s', (_label, question, message) => {
    expect(() =>
      parseReviewSnapshot(
        {
          ...reviewSnapshotFixture(),
          questions: [question, unansweredQuestionFixture()],
        },
        EXPECTED_REVIEW,
      ),
    ).toThrow(message);
  });

  it('accepts individual strings exactly at their budgets', () => {
    const question = answeredQuestionFixture({
      text: 'q'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxQuestionTextLength),
      image_key: 'k'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxMediaKeyLength),
      image_url: `/${'p'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxMediaPathLength - 1)}`,
      answers: [
        answerFixture({
          text: 'a'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxAnswerTextLength),
        }),
        answerFixture({
          answer_id: IDS.answerTwo,
          display_order: 2,
          text: 'b'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxAnswerTextLength),
          is_selected: false,
          is_correct: false,
        }),
      ],
    });
    expect(
      parseReviewSnapshot(
        {
          ...reviewSnapshotFixture(),
          questions: [question, unansweredQuestionFixture()],
        },
        EXPECTED_REVIEW,
      ).questions[0]?.text,
    ).toHaveLength(REVIEW_SNAPSHOT_BUDGETS.maxQuestionTextLength);
  });

  it('rejects aggregate text that exceeds the cumulative budget', () => {
    const questions = Array.from(
      { length: REVIEW_SNAPSHOT_BUDGETS.maxQuestions },
      (_, index) => ({
        ...validQuestion(index),
        text: 'q'.repeat(REVIEW_SNAPSHOT_BUDGETS.maxQuestionTextLength),
      }),
    );
    expect(() =>
      parseReviewSnapshot(
        reviewSnapshotFixture({
          total_questions: questions.length,
          total_answered: questions.length,
          correct_count: questions.length,
          unanswered_count: 0,
          score_percentage: 100,
          questions,
        }),
        EXPECTED_REVIEW,
      ),
    ).toThrow('cumulative review text budget');
  });
});
