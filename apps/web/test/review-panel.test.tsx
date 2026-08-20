import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ReviewPanel } from '../src/review/review-panel';
import { buildReviewPageViewModel } from '../src/review/snapshot-contract';
import {
  EXPECTED_REVIEW,
  requiredItem,
  reviewSnapshotFixture,
} from './review-fixtures';

function reviewModel() {
  return buildReviewPageViewModel(reviewSnapshotFixture(), EXPECTED_REVIEW);
}

describe('ReviewPanel', () => {
  it('announces the score and pass state without a visual-only signal', () => {
    render(<ReviewPanel review={reviewModel()} />);

    expect(
      screen.getByRole('heading', { name: 'Mashq natijasini tahlil qiling' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Natija 50 foiz')).toHaveTextContent('50%');
    expect(screen.getByLabelText('Natija 50 foiz')).toHaveTextContent(
      'Takrorlash kerak',
    );
  });

  it('renders all summary metrics from the validated view model', () => {
    render(<ReviewPanel review={reviewModel()} />);

    const metrics = screen.getByText('Savollar').parentElement;
    expect(metrics).not.toBeNull();
    expect(metrics).toHaveTextContent('2');
    expect(screen.getByText("To'g'ri", { selector: 'dt' }).parentElement).toHaveTextContent('1');
    expect(screen.getByText("Noto'g'ri", { selector: 'dt' }).parentElement).toHaveTextContent('0');
    expect(screen.getByText('Javobsiz', { selector: 'dt' }).parentElement).toHaveTextContent('1');
    expect(screen.getByText('Vaqt', { selector: 'dt' }).parentElement).toHaveTextContent('1:00');
  });

  it('labels correct and unanswered questions in text', () => {
    render(<ReviewPanel review={reviewModel()} />);

    const first = screen.getByText('Sintetik savol A').closest('summary');
    const second = screen.getByText('Sintetik savol B').closest('summary');
    expect(first).toHaveTextContent("To'g'ri");
    expect(second).toHaveTextContent('Javobsiz');
  });

  it('shows answer semantics after expanding a question', async () => {
    const user = userEvent.setup();
    render(<ReviewPanel review={reviewModel()} />);
    const firstSummary = screen.getByText('Sintetik savol A').closest('summary');
    if (firstSummary === null) throw new Error('Question summary is missing');
    await user.click(firstSummary);

    const answerList = screen.getByRole('list', { name: '1-savol javoblari' });
    expect(within(answerList).getByText("To'g'ri javob")).toBeVisible();
    expect(within(answerList).getByText('Sintetik javob A')).toBeVisible();
    expect(within(answerList).getByText('Sintetik javob B')).toBeVisible();
  });

  it('does not render media elements for a local media reference', () => {
    const snapshot = reviewSnapshotFixture({
      questions: [
        {
          ...requiredItem(reviewSnapshotFixture().questions, 0),
          image_key: 'demo-image',
          image_url: '/media/demo.webp',
        },
        requiredItem(reviewSnapshotFixture().questions, 1),
      ],
    });
    const { container } = render(
      <ReviewPanel
        review={buildReviewPageViewModel(snapshot, EXPECTED_REVIEW)}
      />,
    );

    expect(container.querySelector('img, video, iframe')).toBeNull();
    expect(screen.getByText(/Mahalliy media mavjud/u)).toBeInTheDocument();
  });

  it('renders a clear summary-only state', () => {
    const snapshot = reviewSnapshotFixture({
      mode: 'grand_mock',
      review_kind: 'summary_only',
      total_questions: 0,
      total_answered: 0,
      correct_count: 0,
      incorrect_count: 0,
      unanswered_count: 0,
      score_percentage: 0,
      questions: [],
    });
    render(
      <ReviewPanel
        review={buildReviewPageViewModel(snapshot, EXPECTED_REVIEW)}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      "savollar kesimidagi ma'lumot ko'rsatilmaydi",
    );
    expect(screen.queryByText('Sintetik savol A')).not.toBeInTheDocument();
  });

  it('supports a caller-provided heading without changing result semantics', () => {
    render(<ReviewPanel review={reviewModel()} heading="Demo natija" />);
    expect(screen.getByRole('heading', { name: 'Demo natija' })).toBeVisible();
    expect(screen.getByLabelText('Natija 50 foiz')).toBeVisible();
  });
});
