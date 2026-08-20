import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { RoadmapViewModel } from '../src/roadmap/model';
import { RoadmapView } from '../src/roadmap/roadmap-view';

const roadmapCss = readFileSync(
  join(process.cwd(), 'src/roadmap/roadmap.css'),
  'utf8',
);

const MODEL: RoadmapViewModel = {
  nodes: [
    {
      id: 'done',
      label: 'Asoslar',
      order: 0,
      state: 'completed',
      completedUnits: 4,
      totalUnits: 4,
      progressPercent: 100,
    },
    {
      id: 'current',
      label: 'Mashq',
      order: 1,
      state: 'in_progress',
      completedUnits: 2,
      totalUnits: 5,
      progressPercent: 40,
    },
    {
      id: 'locked',
      label: 'Tahlil',
      order: 2,
      state: 'locked',
      completedUnits: 0,
      totalUnits: 3,
      progressPercent: 0,
    },
  ],
  completedStages: 1,
  totalStages: 3,
  overallProgressPercent: 58,
  focusStageId: 'current',
};

describe('RoadmapView', () => {
  it('renders a semantic heading, ordered stages, and aggregate progress', () => {
    const { container } = render(<RoadmapView model={MODEL} />);

    expect(
      screen.getByRole('heading', { name: "Shaxsiy o'rganish yo'li" }),
    ).toBeVisible();
    expect(screen.getByRole('list')).toBeVisible();
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(
      screen.getByRole('progressbar', { name: "Umumiy o'rganish jarayoni" }),
    ).toHaveAttribute('aria-valuenow', '58');
    expect(screen.getByText('1/3 bosqich')).toBeVisible();
  });

  it.each([
    ['Asoslar', 'Tugallangan', '1-bosqich'],
    ['Mashq', 'Davom etmoqda', '2-bosqich'],
    ['Tahlil', 'Yopiq', '3-bosqich'],
  ])('presents %s state with one-based display order', (name, state, order) => {
    render(<RoadmapView model={MODEL} />);
    const button = screen.getByRole('button', { name: new RegExp(name, 'u') });
    expect(button).toHaveTextContent(state);
    expect(button).toHaveTextContent(order);
  });

  it('marks the projected focus as the current step', () => {
    render(<RoadmapView model={MODEL} onActivate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Mashq/u })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('disables every stage when no activation callback is available', () => {
    render(<RoadmapView model={MODEL} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('keeps locked stages disabled even when activation is available', () => {
    render(<RoadmapView model={MODEL} onActivate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Asoslar/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Mashq/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Tahlil/u })).toBeDisabled();
  });

  it('returns the complete node through the activation boundary', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<RoadmapView model={MODEL} onActivate={onActivate} />);

    await user.click(screen.getByRole('button', { name: /Mashq/u }));

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith(MODEL.nodes[1]);
  });

  it('supports native Enter and Space activation', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<RoadmapView model={MODEL} onActivate={onActivate} />);
    const current = screen.getByRole('button', { name: /Mashq/u });

    current.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('moves focus with forward and backward arrow keys', async () => {
    const user = userEvent.setup();
    render(<RoadmapView model={MODEL} onActivate={vi.fn()} />);
    const first = screen.getByRole('button', { name: /Asoslar/u });
    const second = screen.getByRole('button', { name: /Mashq/u });

    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(first).toHaveFocus();
  });

  it('wraps arrow navigation across enabled nodes', async () => {
    const user = userEvent.setup();
    render(<RoadmapView model={MODEL} onActivate={vi.fn()} />);
    const first = screen.getByRole('button', { name: /Asoslar/u });
    const second = screen.getByRole('button', { name: /Mashq/u });

    second.focus();
    await user.keyboard('{ArrowRight}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(second).toHaveFocus();
  });

  it('supports Home and End focus navigation', async () => {
    const user = userEvent.setup();
    render(<RoadmapView model={MODEL} onActivate={vi.fn()} />);
    const first = screen.getByRole('button', { name: /Asoslar/u });
    const second = screen.getByRole('button', { name: /Mashq/u });

    first.focus();
    await user.keyboard('{End}');
    expect(second).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
  });

  it('publishes reduced-motion fallbacks for transitions and transforms', () => {
    expect(roadmapCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(roadmapCss).toContain('transition-duration: 0.01ms');
    expect(roadmapCss).toContain('transform: none');
  });
});
