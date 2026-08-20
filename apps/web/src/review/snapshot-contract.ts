import type {
  QuestionOption,
  ReviewHeaderPresentation,
  ReviewMode,
  ReviewPageQuestionViewModel,
  ReviewPageViewModel,
  ReviewQuestionSnapshot,
  ReviewSnapshot,
  ReviewSnapshotExpectation,
} from './types';
import {
  invalidReviewSnapshot,
  isSafeReviewMediaPath,
  parseWireReviewSnapshot,
  REVIEW_SNAPSHOT_BUDGETS,
  ReviewSnapshotValidationError,
} from './snapshot-validation';

export {
  REVIEW_SNAPSHOT_BUDGETS,
  ReviewSnapshotValidationError,
  isSafeReviewMediaPath,
};

const REVIEW_HEADER_PRESENTATIONS = {
  training: { mode: 'training', labelMode: null },
  exam: { mode: 'exam', labelMode: null },
  category: { mode: 'category', labelMode: null },
  demo: { mode: 'demo', labelMode: null },
  grand_mock: { mode: 'grand_mock', labelMode: null },
  insight: { mode: 'insight', labelMode: null },
  daily: { mode: 'category', labelMode: 'daily' },
  incorrect: { mode: 'category', labelMode: 'incorrect' },
  saved: { mode: 'category', labelMode: 'saved' },
  sign: { mode: 'category', labelMode: 'sign' },
  checkpoint: { mode: 'category', labelMode: 'checkpoint' },
  telegram_quiz: { mode: 'category', labelMode: 'telegram_quiz' },
  extension: { mode: 'category', labelMode: 'extension' },
} as const satisfies Record<ReviewMode, ReviewHeaderPresentation>;

export function getReviewHeaderPresentation(
  mode: unknown,
): ReviewHeaderPresentation {
  if (
    typeof mode !== 'string' ||
    !Object.hasOwn(REVIEW_HEADER_PRESENTATIONS, mode)
  ) {
    invalidReviewSnapshot(`unsupported review header mode: ${String(mode)}`);
  }
  return REVIEW_HEADER_PRESENTATIONS[mode as ReviewMode];
}

export function parseReviewSnapshot(
  value: unknown,
  expected: ReviewSnapshotExpectation,
): ReviewSnapshot {
  return parseWireReviewSnapshot(value, expected);
}

function projectQuestion(
  question: ReviewQuestionSnapshot,
  index: number,
  globalAnswerIds: Set<string>,
): ReviewPageQuestionViewModel {
  if (question.position !== index + 1) {
    invalidReviewSnapshot('question positions must be unique and sequential');
  }
  const localAnswerIds = new Map<string, number>();
  const options: QuestionOption[] = [];
  let markedCorrect = 0;
  let markedSelected = 0;
  let previousDisplayOrder = -1;

  for (const [answerIndex, answer] of question.answers.entries()) {
    if (globalAnswerIds.has(answer.answer_id) || localAnswerIds.has(answer.answer_id)) {
      invalidReviewSnapshot(`duplicate answer_id: ${answer.answer_id}`);
    }
    globalAnswerIds.add(answer.answer_id);
    localAnswerIds.set(answer.answer_id, answerIndex);
    if (answer.display_order <= previousDisplayOrder) {
      invalidReviewSnapshot('answer display_order must be strictly increasing');
    }
    previousDisplayOrder = answer.display_order;
    options.push(Object.freeze({
      id: `F${String(answerIndex + 1)}`,
      text: answer.text,
    }));
    if (answer.is_correct) markedCorrect += 1;
    if (answer.is_selected) markedSelected += 1;
  }

  const correctIndex = localAnswerIds.get(question.correct_answer_id);
  const selectedIndex = question.selected_answer_id === null
    ? undefined
    : localAnswerIds.get(question.selected_answer_id);
  if (markedCorrect !== 1 || correctIndex === undefined) {
    invalidReviewSnapshot(
      'correct_answer_id must identify exactly one marked option',
    );
  }
  if (!question.answers[correctIndex]?.is_correct) {
    invalidReviewSnapshot(
      'correct_answer_id conflicts with the marked correct option',
    );
  }
  if (question.is_unanswered) {
    if (
      question.selected_answer_id !== null ||
      question.is_correct !== null || markedSelected !== 0
    ) {
      invalidReviewSnapshot('unanswered question has a selected outcome');
    }
  } else if (
    selectedIndex === undefined || markedSelected !== 1 ||
    !question.answers[selectedIndex]?.is_selected ||
    question.is_correct !== (selectedIndex === correctIndex)
  ) {
    invalidReviewSnapshot('answered question has an inconsistent selected outcome');
  }

  const correctOption = options[correctIndex];
  if (correctOption === undefined) {
    invalidReviewSnapshot('correct option is missing');
  }
  const selectedOption = selectedIndex === undefined
    ? undefined
    : options[selectedIndex];
  return Object.freeze({
    id: question.question_id,
    position: question.position,
    text: question.text,
    media: Object.freeze({
      ...(question.image_url === null ? {} : { imagePath: question.image_url }),
      ...(question.video_url === null ? {} : { videoPath: question.video_url }),
    }),
    ticketId: question.ticket_id,
    ticketPosition: question.ticket_position,
    ticketNumber: question.ticket_number,
    options: Object.freeze(options),
    correctOptionId: correctOption.id,
    correctOptionText: correctOption.text,
    ...(selectedOption === undefined ? {} : {
      selectedOptionId: selectedOption.id,
      selectedOptionText: selectedOption.text,
    }),
    isCorrect: question.is_correct,
    isUnanswered: question.is_unanswered,
    timeSpentSeconds: question.time_spent_seconds,
    explanationAvailable: question.explanation_available,
  });
}

export function buildReviewPageViewModel(
  value: unknown,
  expected: ReviewSnapshotExpectation,
): ReviewPageViewModel {
  const snapshot = parseReviewSnapshot(value, expected);
  const questionIds = new Set<string>();
  const answerIds = new Set<string>();
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  const questions = snapshot.questions.map((question, index) => {
    if (questionIds.has(question.question_id)) {
      invalidReviewSnapshot(`duplicate question_id: ${question.question_id}`);
    }
    questionIds.add(question.question_id);
    const projected = projectQuestion(question, index, answerIds);
    if (projected.isUnanswered) unansweredCount += 1;
    else if (projected.isCorrect) correctCount += 1;
    else incorrectCount += 1;
    return projected;
  });
  if (
    snapshot.review_kind === 'question_review' &&
    (correctCount !== snapshot.correct_count ||
      incorrectCount !== snapshot.incorrect_count ||
      unansweredCount !== snapshot.unanswered_count)
  ) {
    invalidReviewSnapshot('question outcomes do not match snapshot summary counts');
  }

  return Object.freeze({
    loadedKey: `${snapshot.session_id}:${snapshot.locale}`,
    locale: snapshot.locale,
    reviewKind: snapshot.review_kind,
    session: Object.freeze({
      id: snapshot.session_id,
      revision: snapshot.revision,
      status: snapshot.status,
      mode: snapshot.mode,
      examId: snapshot.exam_id,
      ticketId: snapshot.ticket_id,
      ticketNumber: snapshot.ticket_number,
      startedAt: snapshot.started_at,
      completedAt: snapshot.completed_at,
      timeTakenSeconds: snapshot.time_taken_seconds,
    }),
    summary: Object.freeze({
      totalQuestions: snapshot.total_questions,
      totalAnswered: snapshot.total_answered,
      correctCount: snapshot.correct_count,
      incorrectCount: snapshot.incorrect_count,
      unansweredCount: snapshot.unanswered_count,
      scorePercentage: snapshot.score_percentage,
      hasPassed: snapshot.has_passed,
    }),
    questions: Object.freeze(questions),
  });
}
