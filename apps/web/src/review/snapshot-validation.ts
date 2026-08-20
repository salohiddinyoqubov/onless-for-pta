import { isUuid } from '../shared/uuid';
import type {
  ExamContentLocale,
  ReviewAnswerSnapshot,
  ReviewMode,
  ReviewQuestionSnapshot,
  ReviewSnapshot,
  ReviewSnapshotExpectation,
  ReviewStatus,
} from './types';

export class ReviewSnapshotValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewSnapshotValidationError';
  }
}

export const REVIEW_SNAPSHOT_BUDGETS = Object.freeze({
  maxQuestions: 100,
  maxAnswersPerQuestion: 10,
  maxQuestionTextLength: 2_000,
  maxAnswerTextLength: 1_000,
  maxMediaKeyLength: 256,
  maxMediaPathLength: 2_048,
  maxTotalTextLength: 200_000,
});

interface TextBudget {
  used: number;
}

const REVIEW_MODES = new Set<ReviewMode>([
  'exam', 'training', 'category', 'daily', 'incorrect', 'saved', 'demo',
  'grand_mock', 'checkpoint', 'insight', 'sign', 'telegram_quiz', 'extension',
]);
const REVIEW_STATUSES = new Set<ReviewStatus>([
  'COMPLETED', 'FAILED', 'EXPIRED',
]);
const REVIEW_LOCALES = new Set<ExamContentLocale>([
  'uz', 'ru', 'kaa', 'uz-Cyrl',
]);
const SNAPSHOT_KEYS = new Set([
  'session_id', 'revision', 'status', 'mode', 'locale', 'review_kind',
  'exam_id', 'ticket_id', 'ticket_number', 'started_at', 'completed_at',
  'time_taken_seconds', 'total_questions', 'total_answered', 'correct_count',
  'incorrect_count', 'unanswered_count', 'score_percentage', 'has_passed',
  'questions',
]);
const QUESTION_KEYS = new Set([
  'question_id', 'position', 'text', 'text_locale', 'image_key', 'image_url',
  'video_key', 'video_url', 'ticket_id', 'ticket_position', 'ticket_number',
  'answers', 'correct_answer_id', 'selected_answer_id', 'is_correct',
  'is_unanswered', 'time_spent_seconds', 'explanation_available',
]);
const ANSWER_KEYS = new Set([
  'answer_id', 'display_order', 'text', 'text_locale', 'is_selected',
  'is_correct',
]);

export function invalidReviewSnapshot(message: string): never {
  throw new ReviewSnapshotValidationError(message);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    invalidReviewSnapshot(`${field} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    invalidReviewSnapshot(`${field} contains unsupported field: ${unexpected}`);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidReviewSnapshot(`${field} must be a non-empty string`);
  }
  return value;
}

function boundedString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  const text = requiredString(value, field);
  if (text.length > maximumLength) {
    invalidReviewSnapshot(
      `${field} exceeds the ${String(maximumLength)} character budget`,
    );
  }
  return text;
}

function consumeTextBudget(
  budget: TextBudget,
  text: string,
  field: string,
): void {
  budget.used += text.length;
  if (budget.used > REVIEW_SNAPSHOT_BUDGETS.maxTotalTextLength) {
    invalidReviewSnapshot(
      `${field} exceeds the cumulative review text budget`,
    );
  }
}

function uuid(value: unknown, field: string): string {
  if (!isUuid(value)) invalidReviewSnapshot(`${field} must be a UUID`);
  return value;
}

function nullableUuid(value: unknown, field: string): string | null {
  return value === null ? null : uuid(value, field);
}

function integer(value: unknown, field: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    invalidReviewSnapshot(
      `${field} must be an integer greater than or equal to ${String(minimum)}`,
    );
  }
  return value as number;
}

function nullableInteger(
  value: unknown,
  field: string,
  minimum: number,
): number | null {
  return value === null ? null : integer(value, field, minimum);
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    invalidReviewSnapshot(`${field} must be boolean`);
  }
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidReviewSnapshot(`${field} must be a finite number`);
  }
  return value;
}

const CANONICAL_UTC_RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u;

/** Accepts the single UTC form emitted by Date.toISOString(). */
function dateTime(value: unknown, field: string): string {
  const text = requiredString(value, field);
  const match = CANONICAL_UTC_RFC3339.exec(text);
  if (match === null) {
    invalidReviewSnapshot(
      `${field} must use canonical UTC RFC3339 (YYYY-MM-DDTHH:mm:ss.sssZ)`,
    );
  }
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second, millisecond] = parts;
  if (
    year === undefined || month === undefined || day === undefined ||
    hour === undefined || minute === undefined || second === undefined ||
    millisecond === undefined || year < 1 || month < 1 || month > 12 ||
    day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59
  ) {
    invalidReviewSnapshot(`${field} is not a valid calendar date-time`);
  }
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, millisecond);
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day ||
    instant.getUTCHours() !== hour ||
    instant.getUTCMinutes() !== minute ||
    instant.getUTCSeconds() !== second ||
    instant.getUTCMilliseconds() !== millisecond
  ) {
    invalidReviewSnapshot(`${field} is not a valid calendar date-time`);
  }
  return text;
}

function nullableDateTime(value: unknown, field: string): string | null {
  return value === null ? null : dateTime(value, field);
}

function locale(value: unknown, field: string): ExamContentLocale {
  if (typeof value !== 'string' || !REVIEW_LOCALES.has(value as ExamContentLocale)) {
    invalidReviewSnapshot(`${field} is unsupported`);
  }
  return value as ExamContentLocale;
}

function isAllowedTextLocale(
  textLocale: ExamContentLocale,
  requestedLocale: ExamContentLocale,
): boolean {
  return textLocale === requestedLocale ||
    (textLocale === 'uz' && (requestedLocale === 'ru' || requestedLocale === 'kaa'));
}

/** Review media is deliberately restricted to root-relative public assets. */
export function isSafeReviewMediaPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\?#]/u.test(value)) {
    return false;
  }
  try {
    return !decodeURIComponent(value)
      .split('/')
      .some((segment) => segment === '..' || segment === '.');
  } catch {
    return false;
  }
}

function nullableMedia(value: unknown, field: string): string | null {
  if (value === null) return null;
  const mediaPath = boundedString(
    value,
    field,
    REVIEW_SNAPSHOT_BUDGETS.maxMediaPathLength,
  );
  if (!isSafeReviewMediaPath(mediaPath)) {
    invalidReviewSnapshot(`${field} must be a safe root-relative media path`);
  }
  return mediaPath;
}

function parseAnswer(
  value: unknown,
  field: string,
  snapshotLocale: ExamContentLocale,
  textBudget: TextBudget,
): ReviewAnswerSnapshot {
  const answer = asRecord(value, field);
  assertOnlyKeys(answer, ANSWER_KEYS, field);
  const answerLocale = locale(answer.text_locale, `${field}.text_locale`);
  if (!isAllowedTextLocale(answerLocale, snapshotLocale)) {
    invalidReviewSnapshot(`${field}.text_locale is inconsistent`);
  }
  const text = boundedString(
    answer.text,
    `${field}.text`,
    REVIEW_SNAPSHOT_BUDGETS.maxAnswerTextLength,
  );
  consumeTextBudget(textBudget, text, `${field}.text`);
  return Object.freeze({
    answer_id: uuid(answer.answer_id, `${field}.answer_id`),
    display_order: integer(answer.display_order, `${field}.display_order`, 0),
    text,
    text_locale: answerLocale,
    is_selected: bool(answer.is_selected, `${field}.is_selected`),
    is_correct: bool(answer.is_correct, `${field}.is_correct`),
  });
}

function parseQuestion(
  value: unknown,
  index: number,
  snapshotLocale: ExamContentLocale,
  textBudget: TextBudget,
): ReviewQuestionSnapshot {
  const field = `questions[${String(index)}]`;
  const question = asRecord(value, field);
  assertOnlyKeys(question, QUESTION_KEYS, field);
  if (!Array.isArray(question.answers) || question.answers.length < 2) {
    invalidReviewSnapshot(`${field}.answers must contain at least two options`);
  }
  if (question.answers.length > REVIEW_SNAPSHOT_BUDGETS.maxAnswersPerQuestion) {
    invalidReviewSnapshot(
      `${field}.answers exceeds the ${String(REVIEW_SNAPSHOT_BUDGETS.maxAnswersPerQuestion)} answer budget`,
    );
  }
  const textLocale = locale(question.text_locale, `${field}.text_locale`);
  if (!isAllowedTextLocale(textLocale, snapshotLocale)) {
    invalidReviewSnapshot(`${field}.text_locale is inconsistent`);
  }
  const text = boundedString(
    question.text,
    `${field}.text`,
    REVIEW_SNAPSHOT_BUDGETS.maxQuestionTextLength,
  );
  consumeTextBudget(textBudget, text, `${field}.text`);
  const answers = question.answers.map((answer, answerIndex) =>
    parseAnswer(
      answer,
      `${field}.answers[${String(answerIndex)}]`,
      snapshotLocale,
      textBudget,
    ),
  );
  return Object.freeze({
    question_id: uuid(question.question_id, `${field}.question_id`),
    position: integer(question.position, `${field}.position`, 1),
    text,
    text_locale: textLocale,
    image_key: question.image_key === null
      ? null
      : boundedString(
          question.image_key,
          `${field}.image_key`,
          REVIEW_SNAPSHOT_BUDGETS.maxMediaKeyLength,
        ),
    image_url: nullableMedia(question.image_url, `${field}.image_url`),
    video_key: question.video_key === null
      ? null
      : boundedString(
          question.video_key,
          `${field}.video_key`,
          REVIEW_SNAPSHOT_BUDGETS.maxMediaKeyLength,
        ),
    video_url: nullableMedia(question.video_url, `${field}.video_url`),
    ticket_id: nullableUuid(question.ticket_id, `${field}.ticket_id`),
    ticket_position: nullableInteger(
      question.ticket_position, `${field}.ticket_position`, 1,
    ),
    ticket_number: nullableInteger(
      question.ticket_number, `${field}.ticket_number`, 1,
    ),
    answers: Object.freeze(answers),
    correct_answer_id: uuid(
      question.correct_answer_id, `${field}.correct_answer_id`,
    ),
    selected_answer_id: nullableUuid(
      question.selected_answer_id, `${field}.selected_answer_id`,
    ),
    is_correct: question.is_correct === null
      ? null
      : bool(question.is_correct, `${field}.is_correct`),
    is_unanswered: bool(question.is_unanswered, `${field}.is_unanswered`),
    time_spent_seconds: nullableInteger(
      question.time_spent_seconds, `${field}.time_spent_seconds`, 0,
    ),
    explanation_available: bool(
      question.explanation_available, `${field}.explanation_available`,
    ),
  });
}

function validateSummary(snapshot: ReviewSnapshot): void {
  if (
    !Number.isFinite(snapshot.score_percentage) ||
    snapshot.score_percentage < 0 || snapshot.score_percentage > 100
  ) {
    invalidReviewSnapshot('score_percentage must be between 0 and 100');
  }
  if (
    snapshot.correct_count + snapshot.incorrect_count !== snapshot.total_answered ||
    snapshot.total_answered + snapshot.unanswered_count !== snapshot.total_questions
  ) {
    invalidReviewSnapshot('snapshot summary counts are inconsistent');
  }
  if (snapshot.review_kind === 'summary_only') {
    if (snapshot.mode !== 'grand_mock' || snapshot.questions.length !== 0) {
      invalidReviewSnapshot(
        'summary_only is reserved for an empty Grand Mock review',
      );
    }
  } else if (
    snapshot.mode === 'grand_mock' ||
    snapshot.questions.length !== snapshot.total_questions
  ) {
    invalidReviewSnapshot(
      'question_review must contain every non-Grand-Mock question',
    );
  }
}

export function parseWireReviewSnapshot(
  value: unknown,
  expected: ReviewSnapshotExpectation,
): ReviewSnapshot {
  const snapshot = asRecord(value, 'snapshot');
  assertOnlyKeys(snapshot, SNAPSHOT_KEYS, 'snapshot');
  const sessionId = uuid(snapshot.session_id, 'session_id');
  if (!isUuid(expected.sessionId) || sessionId !== expected.sessionId) {
    invalidReviewSnapshot(
      'snapshot session_id does not match the requested session',
    );
  }
  const snapshotLocale = locale(snapshot.locale, 'locale');
  if (snapshotLocale !== expected.locale) {
    invalidReviewSnapshot('snapshot locale does not match the requested locale');
  }
  if (!Array.isArray(snapshot.questions)) {
    invalidReviewSnapshot('questions must be an array');
  }
  if (snapshot.questions.length > REVIEW_SNAPSHOT_BUDGETS.maxQuestions) {
    invalidReviewSnapshot(
      `questions exceeds the ${String(REVIEW_SNAPSHOT_BUDGETS.maxQuestions)} question budget`,
    );
  }
  if (
    typeof snapshot.status !== 'string' ||
    !REVIEW_STATUSES.has(snapshot.status as ReviewStatus)
  ) {
    invalidReviewSnapshot('snapshot status is not reviewable');
  }
  if (
    typeof snapshot.mode !== 'string' ||
    !REVIEW_MODES.has(snapshot.mode as ReviewMode)
  ) {
    invalidReviewSnapshot('snapshot mode is unsupported');
  }
  if (
    snapshot.review_kind !== 'question_review' &&
    snapshot.review_kind !== 'summary_only'
  ) {
    invalidReviewSnapshot('review_kind is unsupported');
  }

  const textBudget: TextBudget = { used: 0 };
  const normalized = Object.freeze({
    session_id: sessionId,
    revision: integer(snapshot.revision, 'revision', 0),
    status: snapshot.status as ReviewStatus,
    mode: snapshot.mode as ReviewMode,
    locale: snapshotLocale,
    review_kind: snapshot.review_kind,
    exam_id: nullableUuid(snapshot.exam_id, 'exam_id'),
    ticket_id: nullableUuid(snapshot.ticket_id, 'ticket_id'),
    ticket_number: nullableInteger(snapshot.ticket_number, 'ticket_number', 1),
    started_at: dateTime(snapshot.started_at, 'started_at'),
    completed_at: nullableDateTime(snapshot.completed_at, 'completed_at'),
    time_taken_seconds: nullableInteger(
      snapshot.time_taken_seconds, 'time_taken_seconds', 0,
    ),
    total_questions: integer(snapshot.total_questions, 'total_questions', 0),
    total_answered: integer(snapshot.total_answered, 'total_answered', 0),
    correct_count: integer(snapshot.correct_count, 'correct_count', 0),
    incorrect_count: integer(snapshot.incorrect_count, 'incorrect_count', 0),
    unanswered_count: integer(snapshot.unanswered_count, 'unanswered_count', 0),
    score_percentage: finiteNumber(snapshot.score_percentage, 'score_percentage'),
    has_passed: bool(snapshot.has_passed, 'has_passed'),
    questions: Object.freeze(
      snapshot.questions.map((question, index) =>
        parseQuestion(question, index, snapshotLocale, textBudget),
      ),
    ),
  }) satisfies ReviewSnapshot;
  validateSummary(normalized);
  return normalized;
}
