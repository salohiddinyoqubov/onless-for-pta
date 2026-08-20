export const EXAM_LIMITS = {
  questionCount: { min: 1, max: 100 },
  durationMinutes: { min: 1, max: 180 },
} as const;
export const EXAM_MODES = [
  'exam',
  'training',
  'category',
  'ticket',
  'grand_mock',
] as const;
export type ExamMode = (typeof EXAM_MODES)[number];
export interface NumericRange {
  readonly min: number;
  readonly max: number;
  readonly default: number;
}
export interface ModeConfig {
  readonly mode: ExamMode;
  readonly questions: NumericRange;
  readonly durationMinutes: NumericRange;
  readonly timed: boolean;
}
const flexibleQuestions: NumericRange = {
  min: EXAM_LIMITS.questionCount.min,
  max: EXAM_LIMITS.questionCount.max,
  default: 20,
};
const flexibleDuration: NumericRange = {
  min: EXAM_LIMITS.durationMinutes.min,
  max: EXAM_LIMITS.durationMinutes.max,
  default: 25,
};
export const MODE_CONFIGS: Readonly<Record<ExamMode, ModeConfig>> = {
  exam: {
    mode: 'exam',
    questions: { min: 20, max: 20, default: 20 },
    durationMinutes: { min: 25, max: 25, default: 25 },
    timed: true,
  },
  training: {
    mode: 'training',
    questions: flexibleQuestions,
    durationMinutes: flexibleDuration,
    timed: false,
  },
  category: {
    mode: 'category',
    questions: flexibleQuestions,
    durationMinutes: flexibleDuration,
    timed: false,
  },
  ticket: {
    mode: 'ticket',
    questions: flexibleQuestions,
    durationMinutes: flexibleDuration,
    timed: false,
  },
  grand_mock: {
    mode: 'grand_mock',
    questions: flexibleQuestions,
    durationMinutes: flexibleDuration,
    timed: true,
  },
};
export class UnsupportedExamModeError extends Error {
  public readonly value: unknown;

  public constructor(value: unknown) {
    super(`Unsupported exam mode: ${String(value)}`);
    this.name = 'UnsupportedExamModeError';
    this.value = value;
  }
}

export function isExamMode(value: unknown): value is ExamMode {
  return typeof value === 'string' && EXAM_MODES.some((mode) => mode === value);
}

export function parseExamMode(value: unknown): ExamMode {
  if (!isExamMode(value)) {
    throw new UnsupportedExamModeError(value);
  }

  return value;
}

export function getModeConfig(mode: unknown): ModeConfig {
  return MODE_CONFIGS[parseExamMode(mode)];
}

export function isIntegerInRange(value: number, range: NumericRange): boolean {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

export function validateModeBounds(
  mode: ExamMode,
  questionCount: number,
  durationMinutes: number,
): readonly string[] {
  const config = MODE_CONFIGS[mode];
  const violations: string[] = [];

  if (!isIntegerInRange(questionCount, config.questions)) {
    violations.push(
      `questionCount must be an integer from ${String(config.questions.min)} to ${String(config.questions.max)} for ${mode}`,
    );
  }

  if (!isIntegerInRange(durationMinutes, config.durationMinutes)) {
    violations.push(
      `durationMinutes must be an integer from ${String(config.durationMinutes.min)} to ${String(config.durationMinutes.max)} for ${mode}`,
    );
  }

  return violations;
}
