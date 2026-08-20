interface AnswerWithId {
  readonly id?: unknown;
  readonly answer_id?: unknown;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Resolves the canonical correct-answer identifier at an untyped boundary. */
export function resolveCorrectOptionId(detail: unknown): string | null {
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) {
    return null;
  }

  const record = detail as Record<string, unknown>;
  return (
    nonEmptyString(record.correctAnswerId) ??
    nonEmptyString(record.correct_answer_id)
  );
}

/** Finds the matching answer without assuming camel-case or wire-case IDs. */
export function resolveCorrectOptionIndex(
  answers: readonly AnswerWithId[] | null | undefined,
  correctId: string | null | undefined,
): number {
  const normalizedId = nonEmptyString(correctId);
  if (answers === null || answers === undefined || normalizedId === null) {
    return -1;
  }

  return answers.findIndex((answer) => {
    const answerId = nonEmptyString(answer.id) ?? nonEmptyString(answer.answer_id);
    return answerId === normalizedId;
  });
}
