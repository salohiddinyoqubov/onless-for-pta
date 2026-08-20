import type {
  AckDisposition,
  AnswerAck,
  AssetDescriptor,
  CanonicalSnapshot,
  ExamPackManifest,
  PositionAck,
  SessionStatus,
  TerminalAck,
} from './contracts';
import { ExamContractError, type ExamContractErrorCode } from './errors';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_PACK_ASSETS = 128;
const MAX_PACK_BYTES = 256 * 1024 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_MIME_TYPE_LENGTH = 128;
const MAX_RETRY_AFTER_MS = 5 * 60 * 1_000;

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(
  value: unknown,
  code: ExamContractErrorCode,
  label: string,
): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExamContractError(code, `${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function stringField(
  value: unknown,
  code: ExamContractErrorCode,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > maximumLength
  ) {
    throw new ExamContractError(
      code,
      `${label} must be a non-empty string of at most ${maximumLength} characters.`,
    );
  }
  return value;
}

function integerField(
  value: unknown,
  code: ExamContractErrorCode,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0 || value > maximum) {
    throw new ExamContractError(code, `${label} must be a bounded non-negative integer.`);
  }
  return value;
}

function member<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: ExamContractErrorCode,
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ExamContractError(code, `${label} is not supported.`);
  }
  return value as T;
}

function decodeDisposition(value: unknown): AckDisposition {
  return member(value, ['accepted', 'duplicate'], 'INVALID_ACK', 'ACK disposition');
}

export function decodePositionAck(value: unknown): PositionAck {
  const candidate = record(value, 'INVALID_ACK', 'Position ACK');
  return {
    disposition: member(
      candidate.disposition,
      ['accepted', 'duplicate', 'stale'],
      'INVALID_ACK',
      'Position ACK disposition',
    ),
    sessionId: stringField(candidate.session_id, 'INVALID_ACK', 'Position ACK session_id'),
    commandId: stringField(
      candidate.position_command_id,
      'INVALID_ACK',
      'Position ACK position_command_id',
    ),
    questionId: stringField(candidate.question_id, 'INVALID_ACK', 'Position ACK question_id'),
    positionSeq: integerField(candidate.position_seq, 'INVALID_ACK', 'Position ACK position_seq'),
  };
}

export function decodeAnswerAck(value: unknown): AnswerAck {
  const candidate = record(value, 'INVALID_ACK', 'Answer ACK');
  return {
    disposition: decodeDisposition(candidate.disposition),
    sessionId: stringField(candidate.session_id, 'INVALID_ACK', 'Answer ACK session_id'),
    commandId: stringField(
      candidate.client_answer_id,
      'INVALID_ACK',
      'Answer ACK client_answer_id',
    ),
    revision: integerField(candidate.revision, 'INVALID_ACK', 'Answer ACK revision'),
  };
}

export function decodeTerminalAck(value: unknown): TerminalAck {
  const candidate = record(value, 'INVALID_ACK', 'Terminal ACK');
  return {
    disposition: decodeDisposition(candidate.disposition),
    sessionId: stringField(candidate.session_id, 'INVALID_ACK', 'Terminal ACK session_id'),
    commandId: stringField(
      candidate.client_terminal_id,
      'INVALID_ACK',
      'Terminal ACK client_terminal_id',
    ),
    revision: integerField(candidate.revision, 'INVALID_ACK', 'Terminal ACK revision'),
    status: member(
      candidate.status,
      ['completed', 'abandoned'],
      'INVALID_ACK',
      'Terminal ACK status',
    ),
  };
}

export function decodeSnapshot(value: unknown): CanonicalSnapshot {
  const candidate = record(value, 'INVALID_SNAPSHOT', 'Canonical snapshot');
  return {
    sessionId: stringField(candidate.session_id, 'INVALID_SNAPSHOT', 'Snapshot session_id'),
    revision: integerField(candidate.revision, 'INVALID_SNAPSHOT', 'Snapshot revision'),
    positionSeq: integerField(candidate.position_seq, 'INVALID_SNAPSHOT', 'Snapshot position_seq'),
    status: member<SessionStatus>(
      candidate.status,
      ['in_progress', 'completed', 'abandoned'],
      'INVALID_SNAPSHOT',
      'Snapshot status',
    ),
  };
}

function decodeAsset(value: unknown): AssetDescriptor {
  const candidate = record(value, 'INVALID_MANIFEST', 'Pack asset');
  const digest = stringField(
    candidate.sha256,
    'INVALID_MANIFEST',
    'Pack asset sha256',
    64,
  ).toLowerCase();
  if (!SHA256_PATTERN.test(digest)) {
    throw new ExamContractError('INVALID_MANIFEST', 'Pack asset sha256 must be lowercase hexadecimal.');
  }
  return {
    assetId: stringField(candidate.asset_id, 'INVALID_MANIFEST', 'Pack asset asset_id'),
    digest,
    sizeBytes: integerField(
      candidate.size_bytes,
      'INVALID_MANIFEST',
      'Pack asset size_bytes',
      MAX_ASSET_BYTES,
    ),
    mimeType: stringField(
      candidate.mime_type,
      'INVALID_MANIFEST',
      'Pack asset mime_type',
      MAX_MIME_TYPE_LENGTH,
    ),
  };
}

export function decodePackManifest(value: unknown): ExamPackManifest {
  const candidate = record(value, 'INVALID_MANIFEST', 'Pack manifest');
  if (!Array.isArray(candidate.assets) || candidate.assets.length > MAX_PACK_ASSETS) {
    throw new ExamContractError(
      'INVALID_MANIFEST',
      `Pack assets must be an array with at most ${MAX_PACK_ASSETS} entries.`,
    );
  }
  const assets = candidate.assets.map(decodeAsset);
  const uniqueIds = new Set(assets.map(({ assetId }) => assetId));
  if (uniqueIds.size !== assets.length) {
    throw new ExamContractError('INVALID_MANIFEST', 'Pack asset identifiers must be unique.');
  }
  const totalBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  if (totalBytes > MAX_PACK_BYTES) {
    throw new ExamContractError(
      'INVALID_MANIFEST',
      `Pack assets exceed the cumulative ${MAX_PACK_BYTES}-byte limit.`,
    );
  }
  return {
    sessionId: stringField(candidate.session_id, 'INVALID_MANIFEST', 'Pack session_id'),
    assets,
  };
}

function parseRetrySeconds(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ExamContractError('INVALID_RATE_LIMIT', `${label} must be integer seconds.`);
  }
  return parsed;
}

export function decodeRetryAfterMs(body: unknown, header: string | null | undefined): number {
  const bodyRecord =
    body === undefined || body === null
      ? null
      : record(body, 'INVALID_RATE_LIMIT', 'Rate limit body');
  const bodySeconds = parseRetrySeconds(bodyRecord?.retry_after, 'retry_after');
  const headerSeconds = parseRetrySeconds(header, 'Retry-After');
  if (bodySeconds === null && headerSeconds === null) {
    throw new ExamContractError('INVALID_RATE_LIMIT', 'A retry delay is required.');
  }
  if (bodySeconds !== null && headerSeconds !== null && bodySeconds !== headerSeconds) {
    throw new ExamContractError('INVALID_RATE_LIMIT', 'Retry delay sources disagree.');
  }
  const milliseconds = (bodySeconds ?? headerSeconds ?? 0) * 1_000;
  if (milliseconds > MAX_RETRY_AFTER_MS) {
    throw new ExamContractError('INVALID_RATE_LIMIT', 'Retry delay exceeds the public client bound.');
  }
  return milliseconds;
}
