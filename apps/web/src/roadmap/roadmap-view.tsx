import type { KeyboardEvent } from 'react';

import type { RoadmapNode, RoadmapNodeState, RoadmapViewModel } from './model';
import './roadmap.css';

const STATE_COPY: Record<RoadmapNodeState, string> = {
  completed: 'Tugallangan',
  in_progress: 'Davom etmoqda',
  available: 'Boshlash mumkin',
  locked: 'Yopiq',
};

export interface RoadmapViewProps {
  readonly model: RoadmapViewModel;
  readonly onActivate?: (node: RoadmapNode) => void;
  readonly title?: string;
  readonly description?: string;
}

function focusByOffset(
  current: HTMLButtonElement,
  buttons: readonly HTMLButtonElement[],
  offset: number,
): void {
  const currentIndex = buttons.indexOf(current);
  if (currentIndex < 0 || buttons.length === 0) return;
  const nextIndex = (currentIndex + offset + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
}

function handleNodeNavigation(event: KeyboardEvent<HTMLOListElement>): void {
  if (!(event.target instanceof HTMLButtonElement)) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[data-roadmap-node]:not(:disabled)',
    ),
  );
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      event.preventDefault();
      focusByOffset(event.target, buttons, 1);
      break;
    case 'ArrowUp':
    case 'ArrowLeft':
      event.preventDefault();
      focusByOffset(event.target, buttons, -1);
      break;
    case 'Home':
      event.preventDefault();
      buttons[0]?.focus();
      break;
    case 'End':
      event.preventDefault();
      buttons.at(-1)?.focus();
      break;
  }
}

interface StageNodeProps {
  readonly node: RoadmapNode;
  readonly isFocus: boolean;
  readonly onActivate: ((node: RoadmapNode) => void) | undefined;
}

function StageNode({ node, isFocus, onActivate }: StageNodeProps) {
  const isLocked = node.state === 'locked';
  const isInteractive = !isLocked && onActivate !== undefined;
  const progressText = `${String(node.completedUnits)}/${String(node.totalUnits)}`;
  const displayOrder = node.order + 1;
  const activation = onActivate === undefined || isLocked
    ? undefined
    : () => onActivate(node);

  return (
    <li className="roadmap-stage" data-state={node.state}>
      <div className="roadmap-stage__rail" aria-hidden="true">
        <span className="roadmap-stage__line" />
        <span className="roadmap-stage__marker">
          {node.state === 'completed' ? '✓' : displayOrder}
        </span>
      </div>
      <button
        type="button"
        className="roadmap-stage__card"
        data-roadmap-node
        disabled={!isInteractive}
        aria-current={isFocus ? 'step' : undefined}
        aria-describedby={`roadmap-stage-${node.id}-progress`}
        onClick={activation}
      >
        <span className="roadmap-stage__copy">
          <span className="roadmap-stage__eyebrow">
            {String(displayOrder)}-bosqich
          </span>
          <strong>{node.label}</strong>
          <span className="roadmap-stage__state">{STATE_COPY[node.state]}</span>
        </span>
        <span
          id={`roadmap-stage-${node.id}-progress`}
          className="roadmap-stage__progress"
        >
          <span aria-hidden="true" className="roadmap-stage__progress-track">
            <span style={{ width: `${String(node.progressPercent)}%` }} />
          </span>
          <span className="roadmap-stage__progress-value">{progressText}</span>
        </span>
      </button>
    </li>
  );
}

export function RoadmapView({
  model,
  onActivate,
  title = "Shaxsiy o'rganish yo'li",
  description = "Har bir bosqich keyingi mashqni aniq ko'rsatadi.",
}: RoadmapViewProps) {
  return (
    <section className="roadmap" aria-labelledby="roadmap-title">
      <header className="roadmap__header">
        <div>
          <span className="section-kicker">O'RGANISH XARITASI</span>
          <h2 id="roadmap-title">{title}</h2>
          <p>{description}</p>
        </div>
        <div className="roadmap__summary" aria-label="Bosqichlar holati">
          <strong>{model.overallProgressPercent}%</strong>
          <span>
            {model.completedStages}/{model.totalStages} bosqich
          </span>
        </div>
      </header>
      <div
        className="roadmap__overall-progress"
        role="progressbar"
        aria-label="Umumiy o'rganish jarayoni"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={model.overallProgressPercent}
      >
        <span style={{ width: `${String(model.overallProgressPercent)}%` }} />
      </div>
      <ol className="roadmap__stages" onKeyDown={handleNodeNavigation}>
        {model.nodes.map((node) => (
          <StageNode
            key={node.id}
            node={node}
            isFocus={node.id === model.focusStageId}
            onActivate={onActivate}
          />
        ))}
      </ol>
      <p className="roadmap__keyboard-hint">
        Faol bosqichlar orasida strelka, Home va End tugmalari bilan yuring.
      </p>
    </section>
  );
}
