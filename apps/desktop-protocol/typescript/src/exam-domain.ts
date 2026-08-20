import { z } from 'zod';

import { LOCALES, type Locale } from './i18n.js';
import {
  EXAM_MODES,
  getModeConfig,
  validateModeBounds,
  type ExamMode,
} from './mode-config.js';

const canonicalUuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

function isCanonicalUtcInstant(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

const canonicalInstant = z.string().refine(isCanonicalUtcInstant, {
  message: 'Timestamp must be a canonical UTC ISO-8601 instant',
});

export const SESSION_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

const sessionStatusSchema = z.enum(SESSION_STATUSES);

function addInvariantIssue(
  context: z.RefinementCtx,
  path: string,
  message: string,
): void {
  context.addIssue({ code: 'custom', path: [path], message });
}

const examSessionShape = {
  sessionId: canonicalUuidV4,
  mode: z.enum(EXAM_MODES),
  locale: z.enum(LOCALES),
  questionCount: z.number().int(),
  durationMinutes: z.number().int(),
  currentQuestionIndex: z.number().int().nonnegative(),
  answeredQuestionCount: z.number().int().nonnegative(),
  elapsedSeconds: z.number().int().nonnegative(),
  status: sessionStatusSchema,
  startedAt: canonicalInstant.nullable().default(null),
  completedAt: canonicalInstant.nullable().default(null),
  revision: z.number().int().min(0).max(4_294_967_295),
} as const;

function validateSession(
  session: {
    mode: ExamMode;
    questionCount: number;
    durationMinutes: number;
    currentQuestionIndex: number;
    answeredQuestionCount: number;
    elapsedSeconds: number;
    status: SessionStatus;
    startedAt: string | null;
    completedAt: string | null;
    revision: number;
  },
  context: z.RefinementCtx,
): void {
  for (const violation of validateModeBounds(
    session.mode,
    session.questionCount,
    session.durationMinutes,
  )) {
    addInvariantIssue(context, 'mode', violation);
  }

  if (session.currentQuestionIndex >= session.questionCount) {
    addInvariantIssue(
      context,
      'currentQuestionIndex',
      'Current question index must reference the configured session',
    );
  }

  if (session.answeredQuestionCount > session.questionCount) {
    addInvariantIssue(
      context,
      'answeredQuestionCount',
      'Answered question count cannot exceed question count',
    );
  }

  if (
    (session.status === 'active' || session.status === 'paused') &&
    session.answeredQuestionCount > session.currentQuestionIndex + 1
  ) {
    addInvariantIssue(
      context,
      'answeredQuestionCount',
      'In-progress answers cannot advance beyond the current question',
    );
  }

  if (session.elapsedSeconds > session.durationMinutes * 60) {
    addInvariantIssue(context, 'elapsedSeconds', 'Elapsed time exceeds the session duration');
  }

  if (session.status === 'draft') {
    if (session.startedAt !== null || session.completedAt !== null) {
      addInvariantIssue(context, 'status', 'A draft session cannot have lifecycle timestamps');
    }
    if (
      session.currentQuestionIndex !== 0 ||
      session.answeredQuestionCount !== 0 ||
      session.elapsedSeconds !== 0 ||
      session.revision !== 0
    ) {
      addInvariantIssue(context, 'status', 'A draft session cannot contain progress');
    }
    return;
  }

  if (session.startedAt === null) {
    addInvariantIssue(context, 'startedAt', 'A started session requires startedAt');
  }

  const terminal = session.status === 'completed' || session.status === 'cancelled';
  if (terminal !== (session.completedAt !== null)) {
    addInvariantIssue(
      context,
      'completedAt',
      terminal
        ? 'A terminal session requires completedAt'
        : 'A non-terminal session cannot have completedAt',
    );
  }

  if (
    session.startedAt !== null &&
    session.completedAt !== null &&
    Date.parse(session.completedAt) < Date.parse(session.startedAt)
  ) {
    addInvariantIssue(context, 'completedAt', 'completedAt cannot precede startedAt');
  }
}

export const examSessionSchema = z
  .object(examSessionShape)
  .strict()
  .superRefine(validateSession);

export type ExamSession = z.infer<typeof examSessionSchema>;

const examResultShape = {
  sessionId: canonicalUuidV4,
  mode: z.enum(EXAM_MODES),
  locale: z.enum(LOCALES),
  totalQuestions: z.number().int().positive(),
  answeredQuestions: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  incorrectCount: z.number().int().nonnegative(),
  elapsedSeconds: z.number().int().nonnegative(),
  completedAt: canonicalInstant,
} as const;

export const examResultSchema = z
  .object(examResultShape)
  .strict()
  .superRefine((result, context) => {
    const config = getModeConfig(result.mode);
    if (
      result.totalQuestions < config.questions.min ||
      result.totalQuestions > config.questions.max
    ) {
      addInvariantIssue(context, 'totalQuestions', 'Result question count is outside mode bounds');
    }
    if (result.answeredQuestions > result.totalQuestions) {
      addInvariantIssue(context, 'answeredQuestions', 'Answered count exceeds total questions');
    }
    if (result.correctCount + result.incorrectCount !== result.answeredQuestions) {
      addInvariantIssue(
        context,
        'correctCount',
        'Correct and incorrect counts must equal answered questions',
      );
    }
    if (result.elapsedSeconds > config.durationMinutes.max * 60) {
      addInvariantIssue(context, 'elapsedSeconds', 'Result time exceeds mode duration');
    }
  });

export type ExamResult = z.infer<typeof examResultSchema>;

export interface SessionProgress {
  readonly answered: number;
  readonly unanswered: number;
  readonly elapsedSeconds: number;
  readonly remainingSeconds: number;
  readonly completionRatio: number;
}

export function parseExamSession(value: unknown): ExamSession {
  return examSessionSchema.parse(value);
}

export function parseExamResult(value: unknown): ExamResult {
  return examResultSchema.parse(value);
}

export function sessionProgress(session: ExamSession): SessionProgress {
  const totalSeconds = session.durationMinutes * 60;
  return {
    answered: session.answeredQuestionCount,
    unanswered: session.questionCount - session.answeredQuestionCount,
    elapsedSeconds: session.elapsedSeconds,
    remainingSeconds: totalSeconds - session.elapsedSeconds,
    completionRatio: session.answeredQuestionCount / session.questionCount,
  };
}

export interface ExamSessionWire {
  readonly session_id: string;
  readonly mode: ExamMode;
  readonly locale: Locale;
  readonly question_count: number;
  readonly duration_minutes: number;
  readonly current_question_index: number;
  readonly answered_question_count: number;
  readonly elapsed_seconds: number;
  readonly status: SessionStatus;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly revision: number;
}

export interface ExamResultWire {
  readonly session_id: string;
  readonly mode: ExamMode;
  readonly locale: Locale;
  readonly total_questions: number;
  readonly answered_questions: number;
  readonly correct_count: number;
  readonly incorrect_count: number;
  readonly elapsed_seconds: number;
  readonly completed_at: string;
}

const sessionWireSchema = z
  .object({
    session_id: canonicalUuidV4,
    mode: z.unknown(),
    locale: z.unknown(),
    question_count: z.number(),
    duration_minutes: z.number(),
    current_question_index: z.number(),
    answered_question_count: z.number(),
    elapsed_seconds: z.number(),
    status: z.unknown(),
    started_at: canonicalInstant.nullable().default(null),
    completed_at: canonicalInstant.nullable().default(null),
    revision: z.number(),
  })
  .strict();

const resultWireSchema = z
  .object({
    session_id: canonicalUuidV4,
    mode: z.unknown(),
    locale: z.unknown(),
    total_questions: z.number(),
    answered_questions: z.number(),
    correct_count: z.number(),
    incorrect_count: z.number(),
    elapsed_seconds: z.number(),
    completed_at: z.unknown(),
  })
  .strict();

export function toExamSessionWire(session: ExamSession): ExamSessionWire {
  const validated = parseExamSession(session);
  return {
    session_id: validated.sessionId,
    mode: validated.mode,
    locale: validated.locale,
    question_count: validated.questionCount,
    duration_minutes: validated.durationMinutes,
    current_question_index: validated.currentQuestionIndex,
    answered_question_count: validated.answeredQuestionCount,
    elapsed_seconds: validated.elapsedSeconds,
    status: validated.status,
    started_at: validated.startedAt,
    completed_at: validated.completedAt,
    revision: validated.revision,
  };
}

export function parseExamSessionWire(value: unknown): ExamSession {
  const wire = sessionWireSchema.parse(value);
  return parseExamSession({
    sessionId: wire.session_id,
    mode: wire.mode,
    locale: wire.locale,
    questionCount: wire.question_count,
    durationMinutes: wire.duration_minutes,
    currentQuestionIndex: wire.current_question_index,
    answeredQuestionCount: wire.answered_question_count,
    elapsedSeconds: wire.elapsed_seconds,
    status: wire.status,
    startedAt: wire.started_at,
    completedAt: wire.completed_at,
    revision: wire.revision,
  });
}

export function toExamResultWire(result: ExamResult): ExamResultWire {
  const validated = parseExamResult(result);
  return {
    session_id: validated.sessionId,
    mode: validated.mode,
    locale: validated.locale,
    total_questions: validated.totalQuestions,
    answered_questions: validated.answeredQuestions,
    correct_count: validated.correctCount,
    incorrect_count: validated.incorrectCount,
    elapsed_seconds: validated.elapsedSeconds,
    completed_at: validated.completedAt,
  };
}

export function parseExamResultWire(value: unknown): ExamResult {
  const wire = resultWireSchema.parse(value);
  return parseExamResult({
    sessionId: wire.session_id,
    mode: wire.mode,
    locale: wire.locale,
    totalQuestions: wire.total_questions,
    answeredQuestions: wire.answered_questions,
    correctCount: wire.correct_count,
    incorrectCount: wire.incorrect_count,
    elapsedSeconds: wire.elapsed_seconds,
    completedAt: wire.completed_at,
  });
}
