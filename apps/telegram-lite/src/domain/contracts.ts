export type DashboardLocale = 'uz-Latn-UZ' | 'ru-RU';
export type DashboardTab = 'home' | 'tests' | 'progress';

export interface DemoProfile {
  readonly displayName: string;
}

export interface DashboardStats {
  readonly completedTests: number;
  readonly averageScorePercent: number;
  readonly answeredQuestions: number;
  readonly correctAnswers: number;
}

export interface RecentResult {
  readonly id: string;
  readonly title: string;
  readonly scorePercent: number;
  readonly questionCount: number;
  readonly completedAt: string;
}

export type TicketAvailability = 'available' | 'locked';

export interface TicketSummary {
  readonly id: string;
  readonly number: number;
  readonly questionCount: number;
  readonly attemptCount: number;
  readonly bestScorePercent: number | null;
  readonly availability: TicketAvailability;
}

export interface DashboardSummary {
  readonly profile: DemoProfile;
  readonly stats: DashboardStats;
  readonly recentResults: readonly RecentResult[];
  readonly generatedAt: string;
}

export interface TestCatalog {
  readonly totalQuestions: number;
  readonly tickets: readonly TicketSummary[];
  readonly generatedAt: string;
}

export interface DashboardSnapshot {
  readonly summary: DashboardSummary;
  readonly catalog: TestCatalog;
}

export interface DashboardDataSource {
  load(signal: AbortSignal): Promise<DashboardSnapshot>;
}

export interface ActivationSource {
  readonly revision: number;
}

export class DashboardDataError extends Error {
  public constructor(
    public readonly code: 'unavailable' | 'invalid-fixture',
    message: string,
  ) {
    super(message);
    this.name = 'DashboardDataError';
  }
}

export function assertPercent(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new DashboardDataError('invalid-fixture', `${field} must be between 0 and 100`);
  }
}

export function assertUtcTimestamp(value: string, field: string): void {
  const parsed = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    throw new DashboardDataError('invalid-fixture', `${field} must be a canonical UTC timestamp`);
  }
}

export function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DashboardDataError('invalid-fixture', `${field} must be a non-negative integer`);
  }
}

export function validateSnapshot(snapshot: DashboardSnapshot): DashboardSnapshot {
  if (snapshot.summary.profile.displayName !== 'Demo') {
    throw new DashboardDataError('invalid-fixture', 'Public profile identity must be Demo');
  }
  assertPercent(snapshot.summary.stats.averageScorePercent, 'averageScorePercent');
  assertNonNegativeInteger(snapshot.summary.stats.completedTests, 'completedTests');
  assertNonNegativeInteger(snapshot.summary.stats.answeredQuestions, 'answeredQuestions');
  assertNonNegativeInteger(snapshot.summary.stats.correctAnswers, 'correctAnswers');
  if (snapshot.summary.stats.correctAnswers > snapshot.summary.stats.answeredQuestions) {
    throw new DashboardDataError('invalid-fixture', 'correctAnswers cannot exceed answeredQuestions');
  }
  assertUtcTimestamp(snapshot.summary.generatedAt, 'summary.generatedAt');
  assertUtcTimestamp(snapshot.catalog.generatedAt, 'catalog.generatedAt');
  const identifiers = new Set<string>();
  for (const result of snapshot.summary.recentResults) {
    if (identifiers.has(result.id)) {
      throw new DashboardDataError('invalid-fixture', 'Recent result identifiers must be unique');
    }
    identifiers.add(result.id);
    assertPercent(result.scorePercent, 'recentResult.scorePercent');
    assertNonNegativeInteger(result.questionCount, 'recentResult.questionCount');
    assertUtcTimestamp(result.completedAt, 'recentResult.completedAt');
  }
  assertNonNegativeInteger(snapshot.catalog.totalQuestions, 'catalog.totalQuestions');
  for (const ticket of snapshot.catalog.tickets) {
    if (identifiers.has(ticket.id)) {
      throw new DashboardDataError('invalid-fixture', 'Fixture identifiers must be unique');
    }
    identifiers.add(ticket.id);
    assertNonNegativeInteger(ticket.number, 'ticket.number');
    assertNonNegativeInteger(ticket.questionCount, 'ticket.questionCount');
    assertNonNegativeInteger(ticket.attemptCount, 'ticket.attemptCount');
    if (ticket.bestScorePercent !== null) {
      assertPercent(ticket.bestScorePercent, 'ticket.bestScorePercent');
    }
  }
  return snapshot;
}
