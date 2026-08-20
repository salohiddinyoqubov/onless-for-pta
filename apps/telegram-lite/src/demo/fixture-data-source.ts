import {
  DashboardDataError,
  validateSnapshot,
  type DashboardDataSource,
  type DashboardSnapshot,
} from '../domain/contracts.js';

export const DEMO_GENERATED_AT = '2026-08-01T09:00:00.000Z';

export const DEMO_DASHBOARD_SNAPSHOT: DashboardSnapshot = {
  summary: {
    profile: { displayName: 'Demo' },
    stats: {
      completedTests: 18,
      averageScorePercent: 84,
      answeredQuestions: 360,
      correctAnswers: 302,
    },
    recentResults: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Demo test natijasi',
        scorePercent: 90,
        questionCount: 20,
        completedAt: '2026-07-31T14:30:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        title: 'Takrorlash natijasi',
        scorePercent: 80,
        questionCount: 20,
        completedAt: '2026-07-29T10:15:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        title: 'Mashq natijasi',
        scorePercent: 85,
        questionCount: 20,
        completedAt: '2026-07-27T08:00:00.000Z',
      },
    ],
    generatedAt: DEMO_GENERATED_AT,
  },
  catalog: {
    totalQuestions: 120,
    tickets: [
      {
        id: '00000000-0000-4000-8000-000000000101',
        number: 1,
        questionCount: 20,
        attemptCount: 3,
        bestScorePercent: 90,
        availability: 'available',
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        number: 2,
        questionCount: 20,
        attemptCount: 2,
        bestScorePercent: 85,
        availability: 'available',
      },
      {
        id: '00000000-0000-4000-8000-000000000103',
        number: 3,
        questionCount: 20,
        attemptCount: 1,
        bestScorePercent: 75,
        availability: 'available',
      },
      {
        id: '00000000-0000-4000-8000-000000000104',
        number: 4,
        questionCount: 20,
        attemptCount: 0,
        bestScorePercent: null,
        availability: 'available',
      },
      {
        id: '00000000-0000-4000-8000-000000000105',
        number: 5,
        questionCount: 20,
        attemptCount: 0,
        bestScorePercent: null,
        availability: 'locked',
      },
      {
        id: '00000000-0000-4000-8000-000000000106',
        number: 6,
        questionCount: 20,
        attemptCount: 0,
        bestScorePercent: null,
        availability: 'locked',
      },
    ],
    generatedAt: DEMO_GENERATED_AT,
  },
};

export interface FixtureScheduler {
  wait(signal: AbortSignal): Promise<void>;
}

const immediateScheduler: FixtureScheduler = {
  wait(signal) {
    return signal.aborted
      ? Promise.reject(new DOMException('Request cancelled', 'AbortError'))
      : Promise.resolve();
  },
};

function cloneSnapshot(snapshot: DashboardSnapshot): DashboardSnapshot {
  return {
    summary: {
      ...snapshot.summary,
      profile: { ...snapshot.summary.profile },
      stats: { ...snapshot.summary.stats },
      recentResults: snapshot.summary.recentResults.map((result) => ({ ...result })),
    },
    catalog: {
      ...snapshot.catalog,
      tickets: snapshot.catalog.tickets.map((ticket) => ({ ...ticket })),
    },
  };
}

export class FixtureDashboardDataSource implements DashboardDataSource {
  public constructor(
    private readonly snapshot: DashboardSnapshot = DEMO_DASHBOARD_SNAPSHOT,
    private readonly scheduler: FixtureScheduler = immediateScheduler,
  ) {}

  public async load(signal: AbortSignal): Promise<DashboardSnapshot> {
    await this.scheduler.wait(signal);
    if (signal.aborted) {
      throw new DOMException('Request cancelled', 'AbortError');
    }
    try {
      return validateSnapshot(cloneSnapshot(this.snapshot));
    } catch (error) {
      if (error instanceof DashboardDataError) throw error;
      throw new DashboardDataError('invalid-fixture', 'Demo fixture could not be validated');
    }
  }
}
