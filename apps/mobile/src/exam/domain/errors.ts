export type ExamContractErrorCode =
  | 'INVALID_ACK'
  | 'INVALID_MANIFEST'
  | 'INVALID_RATE_LIMIT'
  | 'INVALID_SNAPSHOT';

export class ExamContractError extends Error {
  public readonly name = 'ExamContractError';

  public constructor(
    public readonly code: ExamContractErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ExamOfflineErrorCode =
  | 'COMPENSATION_FAILED'
  | 'OWNER_INACTIVE'
  | 'PREPARATION_CANCELLED';

export class ExamOfflineError extends Error {
  public readonly name = 'ExamOfflineError';

  public constructor(
    public readonly code: ExamOfflineErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export function describeFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'Unknown offline exam failure';
}
