import {
  decodeAnswerAck,
  decodePackManifest,
  decodePositionAck,
  decodeRetryAfterMs,
  decodeSnapshot,
  decodeTerminalAck,
} from '../src/exam/domain/decoders';
import { ExamContractError } from '../src/exam/domain/errors';
import {
  classifyRetry,
  fullJitterDelay,
  type RetryPolicy,
} from '../src/exam/offline/backoff';
import {
  DEMO_ANSWER_COMMAND_ID,
  DEMO_POSITION_COMMAND_ID,
  DEMO_QUESTION_ID,
  DEMO_SESSION_ID,
  DEMO_TERMINAL_COMMAND_ID,
  FixedRandom,
  ManualClock,
  wireManifest,
} from './fixtures';
describe('untrusted offline response decoders', () => {
  it('decodes minimal acknowledgements without protected response content', () => {
    expect(
      decodePositionAck({
        disposition: 'stale',
        session_id: DEMO_SESSION_ID,
        position_command_id: DEMO_POSITION_COMMAND_ID,
        question_id: DEMO_QUESTION_ID,
        position_seq: 4,
      }),
    ).toEqual({
      disposition: 'stale',
      sessionId: DEMO_SESSION_ID,
      commandId: DEMO_POSITION_COMMAND_ID,
      questionId: DEMO_QUESTION_ID,
      positionSeq: 4,
    });
    expect(
      decodeAnswerAck({
        disposition: 'duplicate',
        session_id: DEMO_SESSION_ID,
        client_answer_id: DEMO_ANSWER_COMMAND_ID,
        revision: 3,
      }),
    ).toMatchObject({ commandId: DEMO_ANSWER_COMMAND_ID, revision: 3 });
    expect(
      decodeTerminalAck({
        disposition: 'accepted',
        session_id: DEMO_SESSION_ID,
        client_terminal_id: DEMO_TERMINAL_COMMAND_ID,
        revision: 3,
        status: 'completed',
      }),
    ).toMatchObject({ commandId: DEMO_TERMINAL_COMMAND_ID, status: 'completed' });
  });
  it.each([
    null,
    [],
    { disposition: 'accepted' },
    {
      disposition: 'accepted',
      session_id: DEMO_SESSION_ID,
      client_answer_id: DEMO_ANSWER_COMMAND_ID,
      revision: -1,
    },
  ])('rejects malformed answer ACK %#', (candidate) => {
    expect(() => decodeAnswerAck(candidate)).toThrow(ExamContractError);
  });
  it('rejects unsupported snapshot state and non-integer revisions', () => {
    expect(() =>
      decodeSnapshot({
        session_id: DEMO_SESSION_ID,
        revision: 1.5,
        position_seq: 2,
        status: 'in_progress',
      }),
    ).toThrow('revision');
    expect(() =>
      decodeSnapshot({
        session_id: DEMO_SESSION_ID,
        revision: 2,
        position_seq: 2,
        status: 'review',
      }),
    ).toThrow('not supported');
  });
  it('decodes only bounded, content-free asset manifests', () => {
    const manifest = decodePackManifest(wireManifest(4));
    expect(manifest.sessionId).toBe(DEMO_SESSION_ID);
    expect(manifest.assets).toHaveLength(4);
    expect(manifest.assets[0]).toEqual({
      assetId: '70000000-0000-4000-8000-000000000001',
      digest: '0'.repeat(63) + '1',
      sizeBytes: 100,
      mimeType: 'image/webp',
    });
  });
  it('rejects duplicate IDs, invalid digests, oversized assets, and unbounded manifests', () => {
    const valid = decodePackManifest(wireManifest(1)).assets[0];
    expect(valid).toBeDefined();
    const duplicate = {
      session_id: DEMO_SESSION_ID,
      assets: [
        {
          asset_id: valid?.assetId,
          sha256: valid?.digest,
          size_bytes: valid?.sizeBytes,
          mime_type: valid?.mimeType,
        },
        {
          asset_id: valid?.assetId,
          sha256: valid?.digest,
          size_bytes: valid?.sizeBytes,
          mime_type: valid?.mimeType,
        },
      ],
    };
    expect(() => decodePackManifest(duplicate)).toThrow('unique');
    expect(() =>
      decodePackManifest({
        session_id: DEMO_SESSION_ID,
        assets: [{ ...duplicate.assets[0], sha256: 'not-a-digest' }],
      }),
    ).toThrow('sha256');
    expect(() =>
      decodePackManifest({
        session_id: DEMO_SESSION_ID,
        assets: [{ ...duplicate.assets[0], size_bytes: 65 * 1024 * 1024 }],
      }),
    ).toThrow('bounded');
    expect(() => decodePackManifest(wireManifest(129))).toThrow('at most 128');
  });
  it('bounds aggregate pack bytes and untrusted identifier and MIME lengths', () => {
    const maximumAssetBytes = 64 * 1024 * 1024;
    const cumulativeOverflow = {
      session_id: DEMO_SESSION_ID,
      assets: Array.from({ length: 5 }, (_, index) => ({
        asset_id: `asset-${index}`,
        sha256: (index + 1).toString(16).padStart(64, '0'),
        size_bytes: maximumAssetBytes,
        mime_type: 'image/webp',
      })),
    };
    expect(() => decodePackManifest(cumulativeOverflow)).toThrow('cumulative');
    expect(() =>
      decodePackManifest({
        session_id: 's'.repeat(129),
        assets: [],
      }),
    ).toThrow('at most 128');
    expect(() =>
      decodePackManifest({
        session_id: DEMO_SESSION_ID,
        assets: [{ ...cumulativeOverflow.assets[0], asset_id: 'a'.repeat(129) }],
      }),
    ).toThrow('at most 128');
    expect(() =>
      decodePackManifest({
        session_id: DEMO_SESSION_ID,
        assets: [{ ...cumulativeOverflow.assets[0], mime_type: 'm'.repeat(129) }],
      }),
    ).toThrow('at most 128');
    expect(() =>
      decodeAnswerAck({
        disposition: 'accepted',
        session_id: DEMO_SESSION_ID,
        client_answer_id: 'c'.repeat(129),
        revision: 1,
      }),
    ).toThrow('at most 128');
  });
  it('requires consistent bounded Retry-After sources', () => {
    expect(decodeRetryAfterMs({ retry_after: 12 }, '12')).toBe(12_000);
    expect(decodeRetryAfterMs({ retry_after: 0 }, null)).toBe(0);
    expect(decodeRetryAfterMs(null, '8')).toBe(8_000);
    expect(() => decodeRetryAfterMs({ retry_after: 12 }, '13')).toThrow('disagree');
    expect(() => decodeRetryAfterMs({}, null)).toThrow('required');
    expect(() => decodeRetryAfterMs({ retry_after: 301 }, null)).toThrow('exceeds');
  });
});
describe('bounded retry classification', () => {
  const policy: RetryPolicy = {
    baseDelayMs: 100,
    maximumDelayMs: 1_000,
    maximumAttempts: 3,
  };
  it.each([
    { sample: -1, expected: 0 },
    { sample: Number.NaN, expected: 0 },
    { sample: 0.5, expected: 200 },
    { sample: 1, expected: 399 },
  ])('bounds full jitter for sample $sample', ({ sample, expected }) => {
    expect(fullJitterDelay(2, new FixedRandom(sample), policy)).toBe(expected);
  });
  it('schedules retryable network failures using injected time and randomness', () => {
    const update = classifyRetry(
      { status: null, code: 'NETWORK_TIMEOUT' },
      0,
      new ManualClock(20_000),
      new FixedRandom(0.5),
      policy,
    );
    expect(update).toEqual({
      status: 'pending',
      retryCount: 1,
      nextRetryAt: 20_100,
      errorCode: 'NETWORK_TIMEOUT',
      updatedAt: 20_000,
    });
  });
  it('honors a valid rate limit and blocks inconsistent or excessive input', () => {
    const clock = new ManualClock(20_000);
    expect(
      classifyRetry(
        { status: 429, body: { retry_after: 3 }, retryAfterHeader: '3' },
        0,
        clock,
        new FixedRandom(),
        policy,
      ),
    ).toMatchObject({ status: 'pending', nextRetryAt: 23_000, errorCode: 'RATE_LIMITED' });
    expect(
      classifyRetry(
        { status: 429, body: { retry_after: 3 }, retryAfterHeader: '4' },
        0,
        clock,
        new FixedRandom(),
        policy,
      ),
    ).toMatchObject({ status: 'blocked', errorCode: 'INVALID_RATE_LIMIT' });
  });
  it('marks conflicts for reconciliation without delay', () => {
    expect(
      classifyRetry(
        { status: 409, code: 'REVISION_CONFLICT' },
        1,
        new ManualClock(7_000),
        new FixedRandom(),
        policy,
      ),
    ).toEqual({
      status: 'conflict',
      retryCount: 2,
      nextRetryAt: 7_000,
      errorCode: 'REVISION_CONFLICT',
      updatedAt: 7_000,
    });
  });
  it('blocks terminal client failures and exhausted retryable failures', () => {
    const clock = new ManualClock(7_000);
    expect(
      classifyRetry({ status: 422, code: 'INVALID_COMMAND' }, 0, clock, new FixedRandom(), policy),
    ).toMatchObject({
      status: 'blocked',
      nextRetryAt: Number.MAX_SAFE_INTEGER,
      errorCode: 'INVALID_COMMAND',
    });
    expect(
      classifyRetry({ status: 503 }, 2, clock, new FixedRandom(), policy),
    ).toMatchObject({ status: 'blocked', retryCount: 3, errorCode: 'RETRY_EXHAUSTED' });
  });
  it('normalizes unsafe error codes before durable storage', () => {
    expect(
      classifyRetry(
        { status: null, code: 'contains sensitive free text' },
        0,
        new ManualClock(),
        new FixedRandom(),
        policy,
      ).errorCode,
    ).toBe('NETWORK_UNKNOWN');
  });
});
