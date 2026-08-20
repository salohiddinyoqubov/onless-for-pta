import type { RetryUpdate } from '../domain/contracts';
import { decodeRetryAfterMs } from '../domain/decoders';
import type { Clock, ExamTransportFailure, RandomSource } from '../ports';

export interface RetryPolicy {
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly maximumAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 1_000,
  maximumDelayMs: 30_000,
  maximumAttempts: 5,
};

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function normalizedRandom(random: RandomSource): number {
  const sample = random.next();
  if (!Number.isFinite(sample) || sample <= 0) return 0;
  if (sample >= 1) return 1 - Number.EPSILON;
  return sample;
}

export function fullJitterDelay(
  retryCount: number,
  random: RandomSource,
  policy: Pick<RetryPolicy, 'baseDelayMs' | 'maximumDelayMs'> = DEFAULT_RETRY_POLICY,
): number {
  const exponent = Math.min(Math.max(0, retryCount), 20);
  const cap = Math.min(policy.maximumDelayMs, policy.baseDelayMs * 2 ** exponent);
  return Math.floor(normalizedRandom(random) * cap);
}

function failureCode(failure: ExamTransportFailure, fallback: string): string {
  return typeof failure.code === 'string' && SAFE_ERROR_CODE.test(failure.code)
    ? failure.code
    : fallback;
}

function blocked(retryCount: number, errorCode: string, now: number): RetryUpdate {
  return {
    status: 'blocked',
    retryCount,
    nextRetryAt: Number.MAX_SAFE_INTEGER,
    errorCode,
    updatedAt: now,
  };
}

export function classifyRetry(
  failure: ExamTransportFailure,
  currentRetryCount: number,
  clock: Clock,
  random: RandomSource,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): RetryUpdate {
  const now = clock.now();
  const retryCount = currentRetryCount + 1;
  if (failure.status === 409) {
    return {
      status: 'conflict',
      retryCount,
      nextRetryAt: now,
      errorCode: failureCode(failure, 'CONFLICT'),
      updatedAt: now,
    };
  }
  if (failure.status === 429) {
    try {
      return {
        status: retryCount >= policy.maximumAttempts ? 'blocked' : 'pending',
        retryCount,
        nextRetryAt:
          retryCount >= policy.maximumAttempts
            ? Number.MAX_SAFE_INTEGER
            : now + decodeRetryAfterMs(failure.body, failure.retryAfterHeader),
        errorCode: retryCount >= policy.maximumAttempts ? 'RETRY_EXHAUSTED' : 'RATE_LIMITED',
        updatedAt: now,
      };
    } catch {
      return blocked(retryCount, 'INVALID_RATE_LIMIT', now);
    }
  }
  const retryable =
    failure.status === null ||
    failure.status === 408 ||
    (failure.status >= 500 && failure.status <= 599);
  if (!retryable) {
    return blocked(
      retryCount,
      failureCode(failure, failure.status === null ? 'NETWORK_UNKNOWN' : `HTTP_${failure.status}`),
      now,
    );
  }
  if (retryCount >= policy.maximumAttempts) {
    return blocked(retryCount, 'RETRY_EXHAUSTED', now);
  }
  return {
    status: 'pending',
    retryCount,
    nextRetryAt: now + fullJitterDelay(retryCount, random, policy),
    errorCode: failureCode(
      failure,
      failure.status === null ? 'NETWORK_UNKNOWN' : `HTTP_${failure.status}`,
    ),
    updatedAt: now,
  };
}
