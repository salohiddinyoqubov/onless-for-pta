import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { getDashboardCopy } from '../dashboard/copy.js';
import type { DashboardLocale, DashboardTab } from '../domain/contracts.js';
import { DashboardIcon } from './icons.js';
import '../dashboard/dashboard.css';

const tabs: readonly DashboardTab[] = ['home', 'tests', 'progress'];

function nextTabIndex(currentIndex: number, key: string): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return tabs.length - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % tabs.length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return (currentIndex - 1 + tabs.length) % tabs.length;
  }
  return null;
}

export function TelegramLiteShell({
  locale,
  activeTab,
  onTabChange,
  children,
}: {
  readonly locale: DashboardLocale;
  readonly activeTab: DashboardTab;
  readonly onTabChange: (tab: DashboardTab) => void;
  readonly children: ReactNode;
}) {
  const copy = getDashboardCopy(locale);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const focusFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    },
    [],
  );

  const focusPanel = (tab: DashboardTab) => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      const tabIndex = tabs.indexOf(tab);
      panelRefs.current[tabIndex]?.focus({ preventScroll: true });
    });
  };

  const activateTab = (tab: DashboardTab, focusContent: boolean) => {
    onTabChange(tab);
    if (focusContent) focusPanel(tab);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const targetIndex = nextTabIndex(index, event.key);
    if (targetIndex === null) return;
    event.preventDefault();
    const targetTab = tabs[targetIndex];
    if (!targetTab) return;
    activateTab(targetTab, false);
    tabRefs.current[targetIndex]?.focus();
  };

  return (
    <div className="root">
      <a
        className="visuallyHidden"
        href={`#tabpanel-${activeTab}`}
        onClick={() => {
          focusPanel(activeTab);
        }}
      >
        {copy.skipToContent}
      </a>
      <div className="shell">
        <header className="header">
          <span className="brand">Onless</span>
          <span className="brandBadge">{copy.badge}</span>
        </header>
        <main id="telegram-lite-main" className="content">
          {tabs.map((tab, index) => {
            const active = tab === activeTab;
            return (
              <section
                key={tab}
                ref={(node) => {
                  panelRefs.current[index] = node;
                }}
                id={`tabpanel-${tab}`}
                role="tabpanel"
                aria-labelledby={`tab-${tab}`}
                tabIndex={active ? 0 : -1}
                hidden={!active}
              >
                {active ? children : null}
              </section>
            );
          })}
        </main>
        <nav aria-label={copy.appName}>
          <div className="nav" role="tablist" aria-label={copy.appName}>
            {tabs.map((tab, index) => {
              const active = tab === activeTab;
              return (
                <button
                  key={tab}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  id={`tab-${tab}`}
                  type="button"
                  role="tab"
                  className={`navLink${active ? ' navLinkActive' : ''}`}
                  aria-selected={active}
                  aria-controls={`tabpanel-${tab}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => {
                    activateTab(tab, true);
                  }}
                  onKeyDown={(event) => {
                    handleTabKeyDown(event, index);
                  }}
                >
                  <DashboardIcon name={tab} />
                  <span>{copy.tabs[tab]}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
