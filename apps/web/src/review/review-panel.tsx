import type {
  ReviewPageQuestionViewModel,
  ReviewPageViewModel,
} from './types';
import './review.css';

export interface ReviewPanelProps {
  readonly review: ReviewPageViewModel;
  readonly heading?: string;
}

const SCORE_FORMATTER = new Intl.NumberFormat('uz-UZ', {
  maximumFractionDigits: 1,
});

function duration(seconds: number | null): string {
  if (seconds === null) return 'Vaqt qayd etilmagan';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes)}:${String(remainder).padStart(2, '0')}`;
}

function questionState(question: ReviewPageQuestionViewModel): {
  readonly label: string;
  readonly className: string;
} {
  if (question.isUnanswered) {
    return { label: 'Javobsiz', className: 'review-question--unanswered' };
  }
  if (question.isCorrect) {
    return { label: "To'g'ri", className: 'review-question--correct' };
  }
  return { label: "Noto'g'ri", className: 'review-question--incorrect' };
}

function ReviewQuestion({ question }: { readonly question: ReviewPageQuestionViewModel }) {
  const state = questionState(question);
  return (
    <details className={`review-question ${state.className}`}>
      <summary>
        <span className="review-question__number" aria-hidden="true">
          {question.position}
        </span>
        <span className="review-question__title">
          <strong>{question.text}</strong>
          <span>
            {state.label} · {duration(question.timeSpentSeconds)}
          </span>
        </span>
        <span className="review-question__status">{state.label}</span>
      </summary>
      <div className="review-question__body">
        {Object.keys(question.media).length > 0 ? (
          <p className="review-question__media-note">
            Mahalliy media mavjud. Ochiq demoda tashqi resurs yuklanmaydi.
          </p>
        ) : null}
        <ol
          className="review-options"
          aria-label={`${String(question.position)}-savol javoblari`}
        >
          {question.options.map((option) => {
            const isCorrect = option.id === question.correctOptionId;
            const isSelected = option.id === question.selectedOptionId;
            const statusLabel = isCorrect
              ? "To'g'ri javob"
              : isSelected
                ? 'Tanlangan javob'
                : null;
            return (
              <li
                key={option.id}
                className="review-option"
                data-correct={isCorrect || undefined}
                data-selected={isSelected || undefined}
              >
                <span className="review-option__key">{option.id}</span>
                <span>{option.text}</span>
                {statusLabel === null ? null : (
                  <span className="review-option__label">{statusLabel}</span>
                )}
              </li>
            );
          })}
        </ol>
        {question.explanationAvailable ? (
          <p className="review-question__explanation">
            Izoh to'liq mahsulotda ko'rsatiladi; savol mazmuni ushbu ochiq
            namunaga kiritilmagan.
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function ReviewPanel({
  review,
  heading = 'Mashq natijasini tahlil qiling',
}: ReviewPanelProps) {
  const { summary, session } = review;
  return (
    <section className="review" aria-labelledby="review-title">
      <header className="review__header">
        <div>
          <span className="section-kicker">NATIJADAN KEYINGI QADAM</span>
          <h2 id="review-title">{heading}</h2>
          <p>
            Natija faqat ball emas: har bir javob keyingi o'rganish qadamiga
            aylantiriladi.
          </p>
        </div>
        <div
          className="review__score"
          data-passed={summary.hasPassed}
          aria-label={`Natija ${SCORE_FORMATTER.format(summary.scorePercentage)} foiz`}
        >
          <strong>{SCORE_FORMATTER.format(summary.scorePercentage)}%</strong>
          <span>{summary.hasPassed ? 'Muvaffaqiyatli' : 'Takrorlash kerak'}</span>
        </div>
      </header>

      <dl className="review__metrics">
        <div>
          <dt>Savollar</dt>
          <dd>{summary.totalQuestions}</dd>
        </div>
        <div>
          <dt>To'g'ri</dt>
          <dd>{summary.correctCount}</dd>
        </div>
        <div>
          <dt>Noto'g'ri</dt>
          <dd>{summary.incorrectCount}</dd>
        </div>
        <div>
          <dt>Javobsiz</dt>
          <dd>{summary.unansweredCount}</dd>
        </div>
        <div>
          <dt>Vaqt</dt>
          <dd>{duration(session.timeTakenSeconds)}</dd>
        </div>
      </dl>

      {review.reviewKind === 'summary_only' ? (
        <div className="review__summary-only" role="status">
          Ushbu formatda savollar kesimidagi ma'lumot ko'rsatilmaydi.
        </div>
      ) : (
        <div className="review__questions">
          {review.questions.map((question) => (
            <ReviewQuestion key={question.id} question={question} />
          ))}
        </div>
      )}
    </section>
  );
}
