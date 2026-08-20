import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Accuracy,
  DataError,
  GeneratedAt,
  LoadingBlock,
  RecentResults,
  Stats,
  TicketGrid,
} from '../src/dashboard/components.js';
import { getDashboardCopy } from '../src/dashboard/copy.js';
import { DEMO_DASHBOARD_SNAPSHOT } from '../src/demo/fixture-data-source.js';

const copy = getDashboardCopy('uz-Latn-UZ');

describe('dashboard presentation components', () => {
  it('uses live-region semantics for loading and error states', () => {
    const retry = () => undefined;
    const { rerender } = render(<LoadingBlock label="Tayyorlanmoqda" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    rerender(<DataError message="Xatolik" retryLabel="Takrorlash" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Xatolik');
    expect(screen.getByRole('button', { name: 'Takrorlash' })).toBeEnabled();
  });

  it('renders semantic definition-list statistics', () => {
    render(
      <Stats
        stats={DEMO_DASHBOARD_SNAPSHOT.summary.stats}
        copy={copy}
        locale="uz-Latn-UZ"
      />,
    );
    expect(screen.getAllByRole('term')[0]).toHaveTextContent(copy.completedTests);
    expect(screen.getAllByRole('definition')[0]).toHaveTextContent('18');
    expect(screen.getAllByRole('definition')[1]).toHaveTextContent('84%');
  });

  it('exposes result headings and machine-readable UTC times', () => {
    render(
      <RecentResults
        results={DEMO_DASHBOARD_SNAPSHOT.summary.recentResults.slice(0, 1)}
        copy={copy}
        locale="uz-Latn-UZ"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Demo test natijasi' })).toBeVisible();
    expect(document.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-07-31T14:30:00.000Z',
    );
  });

  it('describes ticket state without interactive ticket controls', () => {
    render(
      <TicketGrid catalog={DEMO_DASHBOARD_SNAPSHOT.catalog} copy={copy} locale="uz-Latn-UZ" />,
    );
    const first = screen.getByRole('article', { name: 'Bilet 1' });
    expect(first).toHaveAccessibleDescription(/Mavjud/u);
    expect(within(first).queryByRole('button')).not.toBeInTheDocument();
    expect(within(first).queryByRole('link')).not.toBeInTheDocument();
  });

  it('handles a zero-answer accuracy denominator safely', () => {
    const snapshot = {
      ...DEMO_DASHBOARD_SNAPSHOT,
      summary: {
        ...DEMO_DASHBOARD_SNAPSHOT.summary,
        stats: {
          ...DEMO_DASHBOARD_SNAPSHOT.summary.stats,
          answeredQuestions: 0,
          correctAnswers: 0,
        },
      },
    };
    render(<Accuracy snapshot={snapshot} copy={copy} locale="uz-Latn-UZ" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '1');
    expect(screen.getAllByText('0%')).toHaveLength(2);
  });

  it('labels deterministic generation time with UTC explicitly', () => {
    render(
      <GeneratedAt
        value={DEMO_DASHBOARD_SNAPSHOT.summary.generatedAt}
        copy={copy}
        locale="uz-Latn-UZ"
      />,
    );
    expect(screen.getByText(/Namoyish vaqti:/u)).toHaveTextContent('UTC');
    expect(document.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-08-01T09:00:00.000Z',
    );
  });
});
