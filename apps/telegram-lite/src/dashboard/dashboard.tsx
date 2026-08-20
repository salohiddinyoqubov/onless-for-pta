import { useState } from 'react';

import type {
  DashboardDataSource,
  DashboardLocale,
  DashboardSnapshot,
  DashboardTab,
} from '../domain/contracts.js';
import { TelegramLiteShell } from '../shell/shell.js';
import {
  Accuracy,
  DataError,
  GeneratedAt,
  LoadingBlock,
  RecentResults,
  Stats,
  TicketGrid,
} from './components.js';
import { getDashboardCopy, type DashboardCopy } from './copy.js';
import { useDashboard } from './use-dashboard.js';

function HomeView({
  snapshot,
  copy,
  locale,
}: {
  readonly snapshot: DashboardSnapshot;
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  return (
    <>
      <header className="sectionHeader">
        <h1>
          {copy.greeting}, {snapshot.summary.profile.displayName}
        </h1>
        <p>{copy.welcome}</p>
      </header>
      <Stats stats={snapshot.summary.stats} copy={copy} locale={locale} />
      <RecentResults results={snapshot.summary.recentResults} copy={copy} locale={locale} />
      <GeneratedAt value={snapshot.summary.generatedAt} copy={copy} locale={locale} />
    </>
  );
}

function TestsView({
  snapshot,
  copy,
  locale,
}: {
  readonly snapshot: DashboardSnapshot;
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  return (
    <>
      <header className="sectionHeader">
        <h1>{copy.testsTitle}</h1>
        <p>{copy.testsBody}</p>
      </header>
      <TicketGrid catalog={snapshot.catalog} copy={copy} locale={locale} />
      <GeneratedAt value={snapshot.catalog.generatedAt} copy={copy} locale={locale} />
    </>
  );
}

function ProgressView({
  snapshot,
  copy,
  locale,
}: {
  readonly snapshot: DashboardSnapshot;
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  return (
    <>
      <header className="sectionHeader">
        <h1>{copy.progressTitle}</h1>
        <p>{copy.progressBody}</p>
      </header>
      <Stats stats={snapshot.summary.stats} copy={copy} locale={locale} />
      <Accuracy snapshot={snapshot} copy={copy} locale={locale} />
      <GeneratedAt value={snapshot.summary.generatedAt} copy={copy} locale={locale} />
    </>
  );
}

function DashboardView({
  tab,
  snapshot,
  copy,
  locale,
}: {
  readonly tab: DashboardTab;
  readonly snapshot: DashboardSnapshot;
  readonly copy: DashboardCopy;
  readonly locale: DashboardLocale;
}) {
  if (tab === 'tests') {
    return <TestsView snapshot={snapshot} copy={copy} locale={locale} />;
  }
  if (tab === 'progress') {
    return <ProgressView snapshot={snapshot} copy={copy} locale={locale} />;
  }
  return <HomeView snapshot={snapshot} copy={copy} locale={locale} />;
}

export function TelegramLiteDashboard({
  dataSource,
  locale,
  activationRevision = 0,
}: {
  readonly dataSource: DashboardDataSource;
  readonly locale: DashboardLocale;
  readonly activationRevision?: number;
}) {
  const [tab, setTab] = useState<DashboardTab>('home');
  const state = useDashboard(dataSource, activationRevision);
  const copy = getDashboardCopy(locale);

  return (
    <TelegramLiteShell locale={locale} activeTab={tab} onTabChange={setTab}>
      {state.status === 'loading' ? <LoadingBlock label={copy.loading} /> : null}
      {state.status === 'refreshing' ? (
        <div className="visuallyHidden" role="status" aria-live="polite">
          {copy.refreshing}
        </div>
      ) : null}
      {state.status === 'error' ? (
        <DataError message={copy.unavailable} retryLabel={copy.retry} onRetry={state.refresh} />
      ) : null}
      {state.snapshot ? (
        <DashboardView tab={tab} snapshot={state.snapshot} copy={copy} locale={locale} />
      ) : null}
    </TelegramLiteShell>
  );
}
