export type StageStatus =
  | 'locked'
  | 'available'
  | 'in_progress'
  | 'completed';

export interface RoadmapStageProgress {
  readonly completed: number;
  readonly total: number;
}

export interface RoadmapProjectionStage {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly status: StageStatus;
  readonly progress: RoadmapStageProgress;
}

/** Exact public JSON contract shared by the fixture API and this client. */
export interface RoadmapProjection {
  readonly stages: readonly RoadmapProjectionStage[];
}

export type RoadmapNodeState = StageStatus;

export interface RoadmapNode {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly state: RoadmapNodeState;
  readonly completedUnits: number;
  readonly totalUnits: number;
  readonly progressPercent: number;
}

export interface RoadmapViewModel {
  readonly nodes: readonly RoadmapNode[];
  readonly completedStages: number;
  readonly totalStages: number;
  readonly overallProgressPercent: number;
  readonly focusStageId: string | null;
}

export class RoadmapProjectionError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'RoadmapProjectionError';
  }
}
