import type {
  ReviewAnswerSnapshot,
  ReviewQuestionSnapshot,
  ReviewSnapshot,
} from '../src/review/types';

export const IDS = {
  session: '40000000-0000-4000-8000-000000000001',
  questionOne: '41000000-0000-4000-8000-000000000001',
  questionTwo: '41000000-0000-4000-8000-000000000002',
  answerOne: '42000000-0000-4000-8000-000000000001',
  answerTwo: '42000000-0000-4000-8000-000000000002',
  answerThree: '42000000-0000-4000-8000-000000000003',
  answerFour: '42000000-0000-4000-8000-000000000004',
} as const;

export function requiredItem<T>(
  values: readonly T[],
  index: number,
): T {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`Missing fixture item at ${String(index)}`);
  }
  return value;
}

export function answerFixture(
  overrides: Partial<ReviewAnswerSnapshot> = {},
): ReviewAnswerSnapshot {
  return {
    answer_id: IDS.answerOne,
    display_order: 1,
    text: 'Sintetik javob A',
    text_locale: 'uz',
    is_selected: true,
    is_correct: true,
    ...overrides,
  };
}

export function answeredQuestionFixture(
  overrides: Partial<ReviewQuestionSnapshot> = {},
): ReviewQuestionSnapshot {
  return {
    question_id: IDS.questionOne,
    position: 1,
    text: 'Sintetik savol A',
    text_locale: 'uz',
    image_key: null,
    image_url: null,
    video_key: null,
    video_url: null,
    ticket_id: null,
    ticket_position: null,
    ticket_number: null,
    answers: [
      answerFixture(),
      answerFixture({
        answer_id: IDS.answerTwo,
        display_order: 2,
        text: 'Sintetik javob B',
        is_selected: false,
        is_correct: false,
      }),
    ],
    correct_answer_id: IDS.answerOne,
    selected_answer_id: IDS.answerOne,
    is_correct: true,
    is_unanswered: false,
    time_spent_seconds: 12,
    explanation_available: false,
    ...overrides,
  };
}

export function unansweredQuestionFixture(
  overrides: Partial<ReviewQuestionSnapshot> = {},
): ReviewQuestionSnapshot {
  return answeredQuestionFixture({
    question_id: IDS.questionTwo,
    position: 2,
    text: 'Sintetik savol B',
    answers: [
      answerFixture({
        answer_id: IDS.answerThree,
        is_selected: false,
      }),
      answerFixture({
        answer_id: IDS.answerFour,
        display_order: 2,
        text: 'Sintetik javob D',
        is_selected: false,
        is_correct: false,
      }),
    ],
    correct_answer_id: IDS.answerThree,
    selected_answer_id: null,
    is_correct: null,
    is_unanswered: true,
    time_spent_seconds: null,
    ...overrides,
  });
}

export function reviewSnapshotFixture(
  overrides: Partial<ReviewSnapshot> = {},
): ReviewSnapshot {
  return {
    session_id: IDS.session,
    revision: 1,
    status: 'COMPLETED',
    mode: 'training',
    locale: 'uz',
    review_kind: 'question_review',
    exam_id: null,
    ticket_id: null,
    ticket_number: null,
    started_at: '2026-01-10T10:00:00.000Z',
    completed_at: '2026-01-10T10:01:00.000Z',
    time_taken_seconds: 60,
    total_questions: 2,
    total_answered: 1,
    correct_count: 1,
    incorrect_count: 0,
    unanswered_count: 1,
    score_percentage: 50,
    has_passed: false,
    questions: [answeredQuestionFixture(), unansweredQuestionFixture()],
    ...overrides,
  };
}

export const EXPECTED_REVIEW = {
  sessionId: IDS.session,
  locale: 'uz',
} as const;
