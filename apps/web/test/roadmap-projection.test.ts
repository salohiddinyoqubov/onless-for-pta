import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseRoadmapProjection,
  projectRoadmap,
} from '../src/roadmap/projection';
import {
  RoadmapProjectionError,
  type RoadmapProjectionStage,
  type StageStatus,
} from '../src/roadmap/model';

function stage(
  overrides: Partial<RoadmapProjectionStage> = {},
): RoadmapProjectionStage {
  return {
    id: 'stage-a',
    label: 'Sintetik bosqich',
    order: 0,
    status: 'available',
    progress: { completed: 0, total: 4 },
    ...overrides,
  };
}

function roadmap(stages: readonly unknown[]): unknown {
  return { stages };
}

const apiSerializedFixture: unknown = JSON.parse(
  readFileSync(
    join(process.cwd(), 'test/fixtures/api-roadmap-projection.json'),
    'utf8',
  ),
);

describe('RoadmapProjection JSON contract', () => {
  it('consumes the exact fixture serialized by the public API route', () => {
    const parsed = parseRoadmapProjection(apiSerializedFixture);
    const view = projectRoadmap(apiSerializedFixture);

    expect(parsed.stages).toEqual([
      {
        id: 'foundation',
        label: 'Foundation',
        order: 0,
        status: 'completed',
        progress: { completed: 3, total: 3 },
      },
      {
        id: 'practice',
        label: 'Guided practice',
        order: 1,
        status: 'in_progress',
        progress: { completed: 2, total: 4 },
      },
      {
        id: 'readiness',
        label: 'Exam readiness',
        order: 2,
        status: 'locked',
        progress: { completed: 0, total: 5 },
      },
    ]);
    expect(view.focusStageId).toBe('practice');
    expect(view.overallProgressPercent).toBe(42);
  });

  it('accepts exactly the agreed API fields', () => {
    const value = {
      stages: [
        {
          id: 'foundation',
          label: 'Asoslar',
          order: 0,
          status: 'completed',
          progress: { completed: 6, total: 6 },
        },
        {
          id: 'practice',
          label: 'Mashq',
          order: 1,
          status: 'in_progress',
          progress: { completed: 3, total: 8 },
        },
        {
          id: 'review',
          label: 'Tahlil',
          order: 2,
          status: 'locked',
          progress: { completed: 0, total: 2 },
        },
      ],
    };

    expect(parseRoadmapProjection(value)).toEqual(value);
  });

  it.each([
    [null, 'plain object'],
    [[], 'plain object'],
    [{}, 'non-empty array'],
    [{ stages: null }, 'non-empty array'],
    [{ stages: [] }, 'non-empty array'],
    [{ stages: Array.from({ length: 13 }, (_, order) => stage({ id: `stage-${String(order)}`, order })) }, 'more than 12'],
    [{ stages: [stage()], user_id: 'Demo' }, 'unsupported field'],
  ])('rejects malformed projection %j', (value, message) => {
    expect(() => parseRoadmapProjection(value)).toThrow(message);
  });

  it('rejects inherited projection objects', () => {
    expect(() =>
      parseRoadmapProjection(Object.create({ stages: [stage()] })),
    ).toThrow(RoadmapProjectionError);
  });

  it.each([
    ['id', '', 'at least one character'],
    ['label', '', 'at least one character'],
    ['order', -1, 'between 0 and 11'],
    ['order', 12, 'between 0 and 11'],
    ['order', 1.5, 'between 0 and 11'],
    ['status', 'pending', 'unsupported'],
    ['progress', null, 'plain object'],
  ] as const)('rejects malformed stage %s', (field, value, message) => {
    expect(() =>
      parseRoadmapProjection(roadmap([{ ...stage(), [field]: value }])),
    ).toThrow(message);
  });

  it.each([
    [{ total: 0, completed: 0 }, 'between 1'],
    [{ total: -1, completed: 0 }, 'between 1'],
    [{ total: 1.5, completed: 0 }, 'between 1'],
    [{ total: 4, completed: -1 }, 'non-negative integer'],
    [{ total: 4, completed: 1.2 }, 'non-negative integer'],
    [{ total: 4, completed: 5 }, 'cannot exceed total'],
    [{ total: 4, completed: 0, ratio: 0 }, 'unsupported field'],
  ])('rejects invalid progress %o', (progress, message) => {
    expect(() =>
      parseRoadmapProjection(roadmap([stage({ progress })])),
    ).toThrow(message);
  });

  it('rejects stage-only private fields', () => {
    expect(() =>
      parseRoadmapProjection(
        roadmap([{ ...stage(), ticket_map: ['private-ticket'] }]),
      ),
    ).toThrow('unsupported field: ticket_map');
  });

  it.each([
    ['Uppercase', 'lowercase kebab-case'],
    ['with_underscore', 'lowercase kebab-case'],
    ['2-leading-number', 'lowercase kebab-case'],
    ['contains space', 'lowercase kebab-case'],
    ['a'.repeat(65), 'at most 64'],
  ])('rejects invalid stage identifier %s', (id, message) => {
    expect(() => parseRoadmapProjection(roadmap([stage({ id })]))).toThrow(message);
  });

  it('rejects labels longer than the API contract', () => {
    expect(() =>
      parseRoadmapProjection(roadmap([stage({ label: 'a'.repeat(101) })])),
    ).toThrow('at most 100');
  });

  it('accepts all API maxima including 12 zero-based stages', () => {
    const stages = Array.from({ length: 12 }, (_, order) =>
      stage({
        id: order === 0 ? 'a'.repeat(64) : `stage-${String(order)}`,
        label: order === 0 ? 'L'.repeat(100) : `Stage ${String(order)}`,
        order,
        status: 'locked',
      }),
    );

    const parsed = parseRoadmapProjection(roadmap(stages));
    expect(parsed.stages).toHaveLength(12);
    expect(parsed.stages[0]?.order).toBe(0);
    expect(parsed.stages[11]?.order).toBe(11);
    expect(parsed.stages[0]?.id).toHaveLength(64);
    expect(parsed.stages[0]?.label).toHaveLength(100);
  });

  it.each([
    ['completed', { completed: 3, total: 4 }, 'full progress'],
    ['in_progress', { completed: 0, total: 4 }, 'partial progress'],
    ['in_progress', { completed: 4, total: 4 }, 'partial progress'],
    ['available', { completed: 1, total: 4 }, 'cannot have progress'],
    ['locked', { completed: 1, total: 4 }, 'cannot have progress'],
  ] satisfies readonly (
    readonly [StageStatus, { readonly completed: number; readonly total: number }, string]
  )[])('enforces %s progress invariant', (status, progress, message) => {
    expect(() =>
      parseRoadmapProjection(roadmap([stage({ status, progress })])),
    ).toThrow(message);
  });

  it.each([
    ['completed', { completed: 4, total: 4 }],
    ['in_progress', { completed: 2, total: 4 }],
    ['available', { completed: 0, total: 4 }],
    ['locked', { completed: 0, total: 4 }],
  ] satisfies readonly (
    readonly [StageStatus, { readonly completed: number; readonly total: number }]
  )[])('accepts coherent %s state', (status, progress) => {
    expect(
      parseRoadmapProjection(roadmap([stage({ status, progress })])).stages[0]
        ?.status,
    ).toBe(status);
  });

  it('sorts the public projection by explicit order', () => {
    const parsed = parseRoadmapProjection(
      roadmap([
        stage({ id: 'locked', order: 2, status: 'locked' }),
        stage({
          id: 'complete',
          order: 0,
          status: 'completed',
          progress: { completed: 4, total: 4 },
        }),
        stage({ id: 'active', order: 1, status: 'available' }),
      ]),
    );

    expect(parsed.stages.map(({ id }) => id)).toEqual([
      'complete',
      'active',
      'locked',
    ]);
    expect(Object.isFrozen(parsed.stages)).toBe(true);
  });

  it('does not mutate the caller stage order', () => {
    const input = [
      stage({ id: 'later', order: 1, status: 'locked' }),
      stage({ id: 'first', order: 0, status: 'available' }),
    ];
    parseRoadmapProjection(roadmap(input));
    expect(input.map(({ id }) => id)).toEqual(['later', 'first']);
  });

  it('rejects duplicate identifiers', () => {
    expect(() =>
      parseRoadmapProjection(
        roadmap([
          stage({ status: 'completed', progress: { completed: 4, total: 4 } }),
          stage({ id: 'stage-a', order: 1, status: 'locked' }),
        ]),
      ),
    ).toThrow('duplicate stage id');
  });

  it('rejects duplicate order values', () => {
    expect(() =>
      parseRoadmapProjection(
        roadmap([
          stage({
            id: 'stage-a',
            status: 'completed',
            progress: { completed: 4, total: 4 },
          }),
          stage({ id: 'stage-b', status: 'locked' }),
        ]),
      ),
    ).toThrow('duplicate stage order');
  });

  it.each([
    [
      'completed after locked',
      [
        stage({ id: 'locked', order: 0, status: 'locked' }),
        stage({
          id: 'done',
          order: 1,
          status: 'completed',
          progress: { completed: 4, total: 4 },
        }),
      ],
      'cannot move backward',
    ],
    [
      'two available stages',
      [
        stage({ id: 'one', order: 0 }),
        stage({ id: 'two', order: 1 }),
      ],
      'at most one active',
    ],
    [
      'available and in progress',
      [
        stage({ id: 'one', order: 0 }),
        stage({
          id: 'two',
          order: 1,
          status: 'in_progress',
          progress: { completed: 1, total: 4 },
        }),
      ],
      'at most one active',
    ],
  ] as const)('rejects lifecycle: %s', (_label, stages, message) => {
    expect(() => parseRoadmapProjection(roadmap(stages))).toThrow(message);
  });
});

describe('roadmap view-model projection', () => {
  const projection = roadmap([
    stage({
      id: 'foundation',
      order: 0,
      status: 'completed',
      progress: { completed: 6, total: 6 },
    }),
    stage({
      id: 'practice',
      order: 1,
      status: 'in_progress',
      progress: { completed: 3, total: 6 },
    }),
    stage({ id: 'review', order: 2, status: 'locked', progress: { completed: 0, total: 3 } }),
  ]);

  it('computes aggregate progress from work units', () => {
    const model = projectRoadmap(projection);
    expect(model).toMatchObject({
      completedStages: 1,
      totalStages: 3,
      overallProgressPercent: 60,
      focusStageId: 'practice',
    });
    expect(model.nodes.map(({ progressPercent }) => progressPercent)).toEqual([
      100,
      50,
      0,
    ]);
  });

  it('prefers available stage when no stage is underway', () => {
    const model = projectRoadmap(
      roadmap([
        stage({
          id: 'done',
          status: 'completed',
          progress: { completed: 4, total: 4 },
        }),
        stage({ id: 'next', order: 1, status: 'available' }),
      ]),
    );
    expect(model.focusStageId).toBe('next');
  });

  it('falls back to the last completed stage', () => {
    const model = projectRoadmap(
      roadmap([
        stage({
          id: 'one',
          status: 'completed',
          progress: { completed: 4, total: 4 },
        }),
        stage({
          id: 'two',
          order: 1,
          status: 'completed',
          progress: { completed: 2, total: 2 },
        }),
      ]),
    );
    expect(model.focusStageId).toBe('two');
  });

  it('returns no focus for a fully locked roadmap', () => {
    expect(
      projectRoadmap(roadmap([stage({ status: 'locked' })])).focusStageId,
    ).toBeNull();
  });
});
