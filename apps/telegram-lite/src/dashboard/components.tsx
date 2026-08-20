import type {
  DashboardLocale,
  DashboardSnapshot,
  DashboardStats,
  RecentResult,
  TestCatalog,
} from '../domain/contracts.js';
import type { DashboardCopy } from './copy.js';

export function LoadingBlock({ label }: { readonly label: string }) {
  return (
    <div className="empty" role="status" aria-live="polite" aria-atomic="true">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function DataError({
  message,
  retryLabel,
  onRetry,
}: {
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="alert" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

function statItems(
  stats: DashboardStats,
  copy: DashboardCopy,
  locale: DashboardLocale,
): readonly (readonly [string, string])[] {
  const number = new Intl.NumberFormat(locale);
  return [
    [number.format(stats.completedTests), copy.completedTests],
    [`${number.format(Math.round(stats.averageScorePercent))}%`, copy.averageScore],
    [number.format(stats.answeredQuestions), copy.answeredQuestions],
  ];
}

export function Stats({
  stats,
  copy,
  locale,
}: {
  readonly stats: DashboardStats;
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  return (
    <dl className="statGrid">
      {statItems(stats, copy, locale).map(([value, label]) => (
        <div key={label} className="stat">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResultItem({
  result,
  locale,
}: {
  readonly result: RecentResult;
  readonly locale: DashboardLocale;
}) {
  const formattedDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(result.completedAt));
  const number = new Intl.NumberFormat(locale);
  return (
    <article className="panel" aria-labelledby={`result-${result.id}`}>
      <div>
        <h3 id={`result-${result.id}`}>{result.title}</h3>
        <p>
          {number.format(result.questionCount)} ·{' '}
          <time dateTime={result.completedAt}>{formattedDate}</time>
        </p>
      </div>
      <strong className="score">{number.format(Math.round(result.scorePercent))}%</strong>
    </article>
  );
}

export function RecentResults({
  results,
  copy,
  locale,
}: {
  readonly results: readonly RecentResult[];
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  return (
    <section className="stack" aria-labelledby="recent-results-heading">
      <div className="sectionHeader">
        <h2 id="recent-results-heading">{copy.recentResults}</h2>
      </div>
      {results.length === 0 ? (
        <p className="empty">{copy.noRecentResults}</p>
      ) : (
        results.map((result) => <ResultItem key={result.id} result={result} locale={locale} />)
      )}
    </section>
  );
}

export function TicketGrid({
  catalog,
  copy,
  locale,
}: {
  readonly catalog: TestCatalog;
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  const number = new Intl.NumberFormat(locale);
  return (
    <section className="stack" aria-labelledby="ticket-heading">
      <div className="ticketHeading">
        <h2 id="ticket-heading">{copy.testsTitle}</h2>
        <span>
          {copy.totalQuestions}: {number.format(catalog.totalQuestions)}
        </span>
      </div>
      <ul className="ticketGrid">
        {catalog.tickets.map((ticket) => {
          const status = ticket.availability === 'locked' ? copy.locked : copy.available;
          return (
            <li key={ticket.id}>
              <article
                className="ticketCard"
                aria-labelledby={`ticket-${ticket.id}`}
                aria-describedby={`ticket-status-${ticket.id}`}
              >
                <h3 id={`ticket-${ticket.id}`} className="ticketTitle">
                  {copy.ticket} {number.format(ticket.number)}
                </h3>
                <span className="ticketMeta">
                  {copy.questionCount}: {number.format(ticket.questionCount)}
                </span>
                <span className="ticketMeta">
                  {copy.attempts}: {number.format(ticket.attemptCount)}
                </span>
                <strong id={`ticket-status-${ticket.id}`} className="ticketResult">
                  {status}
                  {ticket.bestScorePercent === null
                    ? ''
                    : ` · ${copy.bestScore}: ${number.format(ticket.bestScorePercent)}%`}
                </strong>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GeneratedAt({
  value,
  copy,
  locale,
}: {
  readonly value: string;
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
  return (
    <p className="empty">
      {copy.generatedAt}: <time dateTime={value}>{formatted}</time> UTC
    </p>
  );
}

export function Accuracy({
  snapshot,
  copy,
  locale,
}: {
  readonly snapshot: DashboardSnapshot;
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  const { correctAnswers, answeredQuestions } = snapshot.summary.stats;
  const percent = answeredQuestions === 0 ? 0 : Math.round((correctAnswers / answeredQuestions) * 100);
  const number = new Intl.NumberFormat(locale);
  return (
    <section className="panel" aria-labelledby="accuracy-heading">
      <div>
        <h2 id="accuracy-heading">{copy.accuracy}</h2>
        <p>
          {number.format(correctAnswers)} / {number.format(answeredQuestions)}
        </p>
      </div>
      <strong className="score">{number.format(percent)}%</strong>
      <progress value={correctAnswers} max={Math.max(answeredQuestions, 1)}>
        {percent}%
      </progress>
    </section>
  );
}
