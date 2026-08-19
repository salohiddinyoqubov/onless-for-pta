import type { SessionMode, UserRole } from './types';

export type ExamLocale = 'uz' | 'ru' | 'kaa' | 'uz-Cyrl';
export type ExamRouteRole = UserRole | 'curator';
export type ExamLaunchIntent = 'resume_or_create' | 'force_new';
export type ExamEntrySurface =
  | 'practice'
  | 'dashboard'
  | 'saved'
  | 'incorrect'
  | 'category'
  | 'tests';

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

interface ExamLaunchBase {
  locale: ExamLocale;
  role: ExamRouteRole;
  intent: ExamLaunchIntent;
  entrySurface: ExamEntrySurface;
}

export interface TicketExamLaunchDescriptor extends ExamLaunchBase {
  target: 'ticket';
  mode: 'training' | 'incorrect';
  ticketNumber: number | string;
}

export interface CategoryExamLaunchDescriptor extends ExamLaunchBase {
  target: 'category';
  mode: 'category' | 'incorrect';
  categoryIds: NonEmptyReadonlyArray<string>;
  questionCount?: number;
}

type BattleSessionDescriptor = ExamLaunchBase & {
  target: 'session';
  mode: 'battle' | 'async_battle' | 'qualification';
  sessionId: string;
  battleId?: string;
};

type StandardSessionDescriptor = ExamLaunchBase & {
  target: 'session';
  mode: Exclude<SessionMode, 'battle' | 'async_battle' | 'qualification'>;
  sessionId: string;
  battleId?: never;
};

export type SessionExamLaunchDescriptor =
  | BattleSessionDescriptor
  | StandardSessionDescriptor;

export interface RetryExamLaunchDescriptor extends ExamLaunchBase {
  target: 'retry';
  mode: Exclude<
    SessionMode,
    'battle' | 'async_battle' | 'qualification' | 'demo'
  >;
  sessionId: string;
  examId?: string;
}

type PlainMode =
  | 'exam'
  | 'daily'
  | 'grand_mock'
  | 'demo'
  | 'checkpoint'
  | 'insight'
  | 'sign'
  | 'telegram_quiz'
  | 'extension';

type PlainModeDescriptor = ExamLaunchBase & {
  target: 'mode';
  mode: PlainMode;
  filters?: never;
};

type SavedModeDescriptor = ExamLaunchBase & {
  target: 'mode';
  mode: 'saved';
  filters?: { startQuestionId?: string };
};

type IncorrectModeDescriptor = ExamLaunchBase & {
  target: 'mode';
  mode: 'incorrect';
  filters?: { skipInterval?: boolean };
};

type BattleModeDescriptor = ExamLaunchBase & {
  target: 'mode';
  mode: 'battle' | 'async_battle';
  filters: { battleId: string };
};

export type ModeExamLaunchDescriptor =
  | PlainModeDescriptor
  | SavedModeDescriptor
  | IncorrectModeDescriptor
  | BattleModeDescriptor;

/** A route-only contract that prevents selectors crossing launch families. */
export type ExamLaunchDescriptor =
  | TicketExamLaunchDescriptor
  | CategoryExamLaunchDescriptor
  | SessionExamLaunchDescriptor
  | RetryExamLaunchDescriptor
  | ModeExamLaunchDescriptor;

export type ExamRouteTarget = Pick<ExamLaunchDescriptor, 'locale' | 'role'>;

const VALID_LOCALES = new Set<string>(['uz', 'ru', 'kaa', 'uz-Cyrl']);
const VALID_ROLES = new Set<string>([
  'student',
  'mentor',
  'business',
  'investor',
  'admin',
  'sales_manager',
  'onkurs_admin',
  'curator',
]);
const VALID_INTENTS = new Set<string>(['resume_or_create', 'force_new']);
const VALID_ENTRY_SURFACES = new Set<string>([
  'practice',
  'dashboard',
  'saved',
  'incorrect',
  'category',
  'tests',
]);
const VALID_MODES = new Set<string>([
  'exam',
  'training',
  'battle',
  'async_battle',
  'category',
  'demo',
  'incorrect',
  'daily',
  'saved',
  'qualification',
  'grand_mock',
  'insight',
  'sign',
  'checkpoint',
  'telegram_quiz',
  'extension',
]);
const COMMON_KEYS = [
  'locale',
  'role',
  'target',
  'mode',
  'intent',
  'entrySurface',
] as const;
const ENTRY_SURFACES_BY_TARGET: Record<
  ExamLaunchDescriptor['target'],
  ReadonlySet<ExamEntrySurface>
> = {
  ticket: new Set(['practice', 'incorrect', 'tests']),
  category: new Set(['category', 'incorrect']),
  session: new Set([
    'dashboard',
    'practice',
    'saved',
    'incorrect',
    'category',
    'tests',
  ]),
  retry: new Set(['tests']),
  mode: new Set(['dashboard', 'saved', 'incorrect', 'tests']),
};

function assertNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertOnlyKeys(
  descriptor: Record<string, unknown>,
  targetKeys: readonly string[],
): void {
  const allowed = new Set<string>([...COMMON_KEYS, ...targetKeys]);
  const unexpected = Object.keys(descriptor).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    throw new TypeError(
      `Unexpected ${String(descriptor.target)} launch field: ${unexpected}`,
    );
  }
}

function assertEntrySurfaceForTarget(descriptor: ExamLaunchDescriptor): void {
  if (!ENTRY_SURFACES_BY_TARGET[descriptor.target].has(descriptor.entrySurface)) {
    throw new TypeError(
      `${descriptor.entrySurface} is not valid for ${descriptor.target} launch`,
    );
  }
}

/** Validates descriptors received from JSON or another untyped boundary. */
export function assertExamLaunchDescriptor(
  value: unknown,
): asserts value is ExamLaunchDescriptor {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Exam launch descriptor must be an object');
  }

  const descriptor = value as Record<string, unknown>;
  if (!VALID_LOCALES.has(String(descriptor.locale))) {
    throw new TypeError(`Unsupported exam locale: ${String(descriptor.locale)}`);
  }
  if (!VALID_ROLES.has(String(descriptor.role))) {
    throw new TypeError(`Unsupported exam role: ${String(descriptor.role)}`);
  }
  if (!VALID_INTENTS.has(String(descriptor.intent))) {
    throw new TypeError(
      `Unsupported exam launch intent: ${String(descriptor.intent)}`,
    );
  }
  if (!VALID_ENTRY_SURFACES.has(String(descriptor.entrySurface))) {
    throw new TypeError(
      `Unsupported exam entry surface: ${String(descriptor.entrySurface)}`,
    );
  }
  if (!VALID_MODES.has(String(descriptor.mode))) {
    throw new TypeError(`Unsupported exam mode: ${String(descriptor.mode)}`);
  }

  switch (descriptor.target) {
    case 'ticket': {
      assertOnlyKeys(descriptor, ['ticketNumber']);
      if (descriptor.mode !== 'training' && descriptor.mode !== 'incorrect') {
        throw new TypeError('Ticket launches require training or incorrect mode');
      }
      const ticket = descriptor.ticketNumber;
      if (
        (typeof ticket !== 'number' && typeof ticket !== 'string') ||
        (typeof ticket === 'number' &&
          (!Number.isInteger(ticket) || ticket < 1)) ||
        (typeof ticket === 'string' && ticket.trim().length === 0)
      ) {
        throw new TypeError(
          'ticketNumber must be a positive integer or non-empty id',
        );
      }
      break;
    }
    case 'category': {
      assertOnlyKeys(descriptor, ['categoryIds', 'questionCount']);
      if (descriptor.mode !== 'category' && descriptor.mode !== 'incorrect') {
        throw new TypeError(
          'Category launches require category or incorrect mode',
        );
      }
      if (
        !Array.isArray(descriptor.categoryIds) ||
        descriptor.categoryIds.length === 0 ||
        descriptor.categoryIds.some(
          (id) => typeof id !== 'string' || id.trim().length === 0,
        )
      ) {
        throw new TypeError(
          'categoryIds must contain at least one non-empty id',
        );
      }
      const count = descriptor.questionCount;
      if (
        count !== undefined &&
        (typeof count !== 'number' || !Number.isInteger(count) || count < 1)
      ) {
        throw new TypeError('questionCount must be a positive integer');
      }
      break;
    }
    case 'session': {
      assertOnlyKeys(descriptor, ['sessionId', 'battleId']);
      assertNonEmptyString(descriptor.sessionId, 'sessionId');
      const isBattle =
        descriptor.mode === 'battle' ||
        descriptor.mode === 'async_battle' ||
        descriptor.mode === 'qualification';
      if (!isBattle && descriptor.battleId !== undefined) {
        throw new TypeError(
          'battleId is only valid for battle session launches',
        );
      }
      if (descriptor.battleId !== undefined) {
        assertNonEmptyString(descriptor.battleId, 'battleId');
      }
      break;
    }
    case 'retry':
      assertOnlyKeys(descriptor, ['sessionId', 'examId']);
      if (
        descriptor.mode === 'battle' ||
        descriptor.mode === 'async_battle' ||
        descriptor.mode === 'qualification' ||
        descriptor.mode === 'demo'
      ) {
        throw new TypeError(`${descriptor.mode} cannot use retry launch`);
      }
      assertNonEmptyString(descriptor.sessionId, 'sessionId');
      if (descriptor.examId !== undefined) {
        assertNonEmptyString(descriptor.examId, 'examId');
      }
      break;
    case 'mode': {
      assertOnlyKeys(descriptor, ['filters']);
      if (
        descriptor.mode === 'training' ||
        descriptor.mode === 'category' ||
        descriptor.mode === 'qualification'
      ) {
        throw new TypeError(
          `${descriptor.mode} requires a more specific launch target`,
        );
      }
      if (descriptor.filters === undefined) {
        if (
          descriptor.mode === 'battle' ||
          descriptor.mode === 'async_battle'
        ) {
          throw new TypeError(`${descriptor.mode} requires battleId`);
        }
        break;
      }
      if (
        descriptor.filters === null ||
        typeof descriptor.filters !== 'object' ||
        Array.isArray(descriptor.filters)
      ) {
        throw new TypeError('Mode filters must be an object');
      }
      const filters = descriptor.filters as Record<string, unknown>;
      if (descriptor.mode === 'saved') {
        const unexpected = Object.keys(filters).find(
          (key) => key !== 'startQuestionId',
        );
        if (unexpected !== undefined) {
          throw new TypeError(`Unexpected saved filter: ${unexpected}`);
        }
        if (filters.startQuestionId !== undefined) {
          assertNonEmptyString(filters.startQuestionId, 'startQuestionId');
        }
      } else if (descriptor.mode === 'incorrect') {
        const unexpected = Object.keys(filters).find(
          (key) => key !== 'skipInterval',
        );
        if (unexpected !== undefined) {
          throw new TypeError(`Unexpected incorrect filter: ${unexpected}`);
        }
        if (
          filters.skipInterval !== undefined &&
          typeof filters.skipInterval !== 'boolean'
        ) {
          throw new TypeError('skipInterval must be boolean');
        }
      } else if (
        descriptor.mode === 'battle' ||
        descriptor.mode === 'async_battle'
      ) {
        const unexpected = Object.keys(filters).find(
          (key) => key !== 'battleId',
        );
        if (unexpected !== undefined) {
          throw new TypeError(`Unexpected battle filter: ${unexpected}`);
        }
        assertNonEmptyString(filters.battleId, 'battleId');
      } else {
        throw new TypeError(`${String(descriptor.mode)} does not accept filters`);
      }
      break;
    }
    default:
      throw new TypeError(
        `Unsupported exam launch target: ${String(descriptor.target)}`,
      );
  }

  assertEntrySurfaceForTarget(value as ExamLaunchDescriptor);
}

export function buildDashboardBaseHref({
  locale,
  role,
}: {
  locale: string;
  role: string;
}): string {
  if (!VALID_LOCALES.has(locale)) {
    throw new TypeError(`Unsupported exam locale: ${locale}`);
  }
  if (!VALID_ROLES.has(role)) {
    throw new TypeError(`Unsupported exam role: ${role}`);
  }
  return `/${locale}/dashboard/${role}`;
}

/** Resolves untrusted route parameters without interpolating invalid segments. */
export function resolveDashboardBaseHref({
  locale,
  role,
}: {
  locale: string;
  role: string;
}): string {
  return VALID_LOCALES.has(locale) && VALID_ROLES.has(role)
    ? `/${locale}/dashboard/${role}`
    : '/';
}

function examPath(target: ExamRouteTarget): string {
  return `${buildDashboardBaseHref(target)}/exam`;
}

export function buildExamLaunchHref(
  descriptor: ExamLaunchDescriptor,
): string {
  assertExamLaunchDescriptor(descriptor);

  const params = new URLSearchParams({
    launch_type: descriptor.target,
    mode: descriptor.mode,
    intent: descriptor.intent,
    entry_surface: descriptor.entrySurface,
  });

  switch (descriptor.target) {
    case 'ticket':
      params.set('ticket_number', String(descriptor.ticketNumber));
      break;
    case 'category':
      params.set('category_ids', descriptor.categoryIds.join(','));
      if (descriptor.questionCount !== undefined) {
        params.set('question_count', String(descriptor.questionCount));
      }
      break;
    case 'session':
      params.set('session_id', descriptor.sessionId);
      if (descriptor.battleId !== undefined) {
        params.set('battle_id', descriptor.battleId);
      }
      break;
    case 'retry':
      params.set('retry_session_id', descriptor.sessionId);
      if (descriptor.examId !== undefined) {
        params.set('exam_id', descriptor.examId);
      }
      break;
    case 'mode':
      if (descriptor.mode === 'saved' && descriptor.filters?.startQuestionId) {
        params.set('start_question', descriptor.filters.startQuestionId);
      } else if (
        descriptor.mode === 'incorrect' &&
        descriptor.filters?.skipInterval
      ) {
        params.set('skip_interval', 'true');
      } else if (
        descriptor.mode === 'battle' ||
        descriptor.mode === 'async_battle'
      ) {
        params.set('battle_id', descriptor.filters.battleId);
      }
      break;
  }

  return `${examPath(descriptor)}?${params.toString()}`;
}

/** Query variants share one route shell and therefore one prefetch target. */
export function buildExamPrefetchHref(target: ExamRouteTarget): string {
  return examPath(target);
}
