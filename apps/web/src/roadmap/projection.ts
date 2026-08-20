import {
  RoadmapProjectionError,
  type RoadmapNode,
  type RoadmapProjection,
  type RoadmapProjectionStage,
  type RoadmapViewModel,
  type StageStatus,
} from './model';

const PROJECTION_KEYS = new Set(['stages']);
const STAGE_KEYS = new Set(['id', 'label', 'order', 'status', 'progress']);
const PROGRESS_KEYS = new Set(['completed', 'total']);
const STAGE_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const STAGE_STATUSES = new Set<StageStatus>([
  'locked',
  'available',
  'in_progress',
  'completed',
]);

function invalid(message: string): never {
  throw new RoadmapProjectionError(message);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    invalid(`${field} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected !== undefined) {
    invalid(`${field} contains unsupported field: ${unexpected}`);
  }
}

function boundedString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== 'string' || value.length < 1) {
    invalid(`${field} must contain at least one character`);
  }
  if (value.length > maximumLength) {
    invalid(`${field} must contain at most ${String(maximumLength)} characters`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    invalid(
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    invalid(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function status(value: unknown, field: string): StageStatus {
  if (typeof value !== 'string' || !STAGE_STATUSES.has(value as StageStatus)) {
    invalid(`${field} is unsupported`);
  }
  return value as StageStatus;
}

function parseStage(value: unknown, index: number): RoadmapProjectionStage {
  const field = `stages[${String(index)}]`;
  const stage = record(value, field);
  onlyKeys(stage, STAGE_KEYS, field);
  const progress = record(stage.progress, `${field}.progress`);
  onlyKeys(progress, PROGRESS_KEYS, `${field}.progress`);
  const total = boundedInteger(
    progress.total,
    `${field}.progress.total`,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const completed = nonNegativeInteger(
    progress.completed,
    `${field}.progress.completed`,
  );
  if (completed > total) {
    invalid(`${field}.progress.completed cannot exceed total`);
  }
  const id = boundedString(stage.id, `${field}.id`, 64);
  if (!STAGE_ID_PATTERN.test(id)) {
    invalid(`${field}.id must use lowercase kebab-case`);
  }
  return Object.freeze({
    id,
    label: boundedString(stage.label, `${field}.label`, 100),
    order: boundedInteger(stage.order, `${field}.order`, 0, 11),
    status: status(stage.status, `${field}.status`),
    progress: Object.freeze({ completed, total }),
  });
}

function assertStageState(stage: RoadmapProjectionStage): void {
  const { completed, total } = stage.progress;
  switch (stage.status) {
    case 'completed':
      if (completed !== total) {
        invalid(`${stage.id} completed stage must have full progress`);
      }
      break;
    case 'in_progress':
      if (completed < 1 || completed >= total) {
        invalid(`${stage.id} in-progress stage needs partial progress`);
      }
      break;
    case 'available':
    case 'locked':
      if (completed !== 0) {
        invalid(`${stage.id} ${stage.status} stage cannot have progress`);
      }
      break;
  }
}

function assertLifecycle(stages: readonly RoadmapProjectionStage[]): void {
  const rank: Record<StageStatus, number> = {
    completed: 0,
    in_progress: 1,
    available: 1,
    locked: 2,
  };
  let previousRank = 0;
  let activeStages = 0;
  for (const stage of stages) {
    assertStageState(stage);
    const currentRank = rank[stage.status];
    if (currentRank < previousRank) {
      invalid('stage lifecycle cannot move backward');
    }
    previousRank = currentRank;
    if (stage.status === 'available' || stage.status === 'in_progress') {
      activeStages += 1;
    }
  }
  if (activeStages > 1) invalid('roadmap can expose at most one active stage');
}

export function parseRoadmapProjection(value: unknown): RoadmapProjection {
  const projection = record(value, 'roadmap');
  onlyKeys(projection, PROJECTION_KEYS, 'roadmap');
  if (!Array.isArray(projection.stages) || projection.stages.length === 0) {
    invalid('roadmap.stages must be a non-empty array');
  }
  if (projection.stages.length > 12) {
    invalid('roadmap.stages cannot contain more than 12 stages');
  }
  const stages = projection.stages
    .map(parseStage)
    .sort((left, right) => left.order - right.order);
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const stage of stages) {
    if (ids.has(stage.id)) invalid(`duplicate stage id: ${stage.id}`);
    if (orders.has(stage.order)) {
      invalid(`duplicate stage order: ${String(stage.order)}`);
    }
    ids.add(stage.id);
    orders.add(stage.order);
  }
  assertLifecycle(stages);
  return Object.freeze({ stages: Object.freeze(stages) });
}

function toNode(stage: RoadmapProjectionStage): RoadmapNode {
  return Object.freeze({
    id: stage.id,
    label: stage.label,
    order: stage.order,
    state: stage.status,
    completedUnits: stage.progress.completed,
    totalUnits: stage.progress.total,
    progressPercent: Math.round(
      (stage.progress.completed / stage.progress.total) * 100,
    ),
  });
}

export function projectRoadmap(value: unknown): RoadmapViewModel {
  const projection = parseRoadmapProjection(value);
  const nodes = projection.stages.map(toNode);
  const totals = nodes.reduce(
    (summary, node) => ({
      completed: summary.completed + node.completedUnits,
      total: summary.total + node.totalUnits,
    }),
    { completed: 0, total: 0 },
  );
  const focusNode =
    nodes.find((node) => node.state === 'in_progress') ??
    nodes.find((node) => node.state === 'available') ??
    [...nodes].reverse().find((node) => node.state === 'completed');

  return Object.freeze({
    nodes: Object.freeze(nodes),
    completedStages: nodes.filter((node) => node.state === 'completed').length,
    totalStages: nodes.length,
    overallProgressPercent: Math.round((totals.completed / totals.total) * 100),
    focusStageId: focusNode?.id ?? null,
  });
}
