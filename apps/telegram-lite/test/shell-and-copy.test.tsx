import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { getDashboardCopy } from '../src/dashboard/copy.js';
import type { DashboardLocale, DashboardTab } from '../src/domain/contracts.js';
import { DashboardIcon, type DashboardIconName } from '../src/shell/icons.js';
import { TelegramLiteShell } from '../src/shell/shell.js';

function ShellHarness({
  locale = 'uz-Latn-UZ',
  initialTab = 'home',
}: {
  readonly locale?: DashboardLocale;
  readonly initialTab?: DashboardTab;
}) {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  return (
    <TelegramLiteShell locale={locale} activeTab={tab} onTabChange={setTab}>
      <h1>{getDashboardCopy(locale).tabs[tab]}</h1>
    </TelegramLiteShell>
  );
}

describe('locale-explicit dashboard copy', () => {
  it.each([
    ['uz-Latn-UZ', 'Bosh sahifa', 'Testlar', 'Progress'],
    ['ru-RU', 'Главная', 'Тесты', 'Прогресс'],
  ] as const)('provides all three public tabs for %s', (locale, home, tests, progress) => {
    expect(getDashboardCopy(locale).tabs).toEqual({ home, tests, progress });
  });

  it('keeps the Uzbek copy internally coherent', () => {
    const copy = getDashboardCopy('uz-Latn-UZ');
    expect(copy.greeting).toBe('Salom');
    expect(copy.completedTests).toBe('Yakunlangan testlar');
    expect(copy.testsBody).toContain('faqat ko‘rish uchun');
    expect(copy.unavailable).not.toContain('error');
  });

  it('keeps the Russian copy internally coherent', () => {
    const copy = getDashboardCopy('ru-RU');
    expect(copy.greeting).toBe('Здравствуйте');
    expect(copy.completedTests).toBe('Завершённые тесты');
    expect(copy.testsBody).toContain('только для просмотра');
    expect(copy.unavailable).not.toContain('error');
  });

  it.each(['uz-Latn-UZ', 'ru-RU'] as const)(
    'excludes transactional and identity-management calls to action in %s',
    (locale) => {
      const serialized = JSON.stringify(getDashboardCopy(locale));
      expect(serialized).not.toMatch(/payme|checkout|to‘lov|оплат|parol|парол|otp/iu);
      expect(serialized).not.toMatch(/telefon|телефон|email|unlink|switch/iu);
    },
  );
});

describe('public dashboard icons', () => {
  it.each<DashboardIconName>(['home', 'tests', 'progress'])(
    'renders the %s icon as decorative SVG content',
    (name) => {
      const { container } = render(<DashboardIcon name={name} />);
      const icon = container.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
      expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    },
  );

  it('accepts an explicit presentation size without affecting semantics', () => {
    const { container } = render(<DashboardIcon name="home" size={28} />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('width', '28');
    expect(icon).toHaveAttribute('height', '28');
    expect(icon).not.toHaveAttribute('aria-label');
  });
});

describe('TelegramLiteShell navigation contract', () => {
  it('exposes one named WAI-ARIA tablist', () => {
    render(<ShellHarness />);
    const tablist = screen.getByRole('tablist', { name: 'Onless Lite namoyishi' });
    expect(tablist).toContainElement(screen.getByRole('tab', { name: 'Bosh sahifa' }));
    expect(tablist).toContainElement(screen.getByRole('tab', { name: 'Testlar' }));
    expect(tablist).toContainElement(screen.getByRole('tab', { name: 'Progress' }));
  });

  it('associates each tab with its panel in both directions', () => {
    render(<ShellHarness initialTab="tests" />);
    const active = screen.getByRole('tab', { name: 'Testlar' });
    const panel = screen.getByRole('tabpanel');
    expect(active).toHaveAttribute('id', 'tab-tests');
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active).toHaveAttribute('aria-controls', 'tabpanel-tests');
    expect(panel).toHaveAttribute('id', 'tabpanel-tests');
    expect(panel).toHaveAttribute('aria-labelledby', 'tab-tests');
    expect(screen.getByRole('heading', { name: 'Testlar' })).toBeVisible();
  });

  it('retains valid relations for hidden inactive panels', () => {
    render(<ShellHarness initialTab="tests" />);
    for (const tab of screen.getAllByRole('tab')) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const panel = panelId ? document.getElementById(panelId) : null;
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      expect(panel?.hidden).toBe(tab.getAttribute('aria-selected') === 'false');
    }
  });

  it('places only the active tab in the sequential keyboard order', () => {
    render(<ShellHarness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Bosh sahifa' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  it('wraps forward navigation from the last tab to the first', async () => {
    const user = userEvent.setup();
    render(<ShellHarness initialTab="progress" />);
    const progress = screen.getByRole('tab', { name: 'Progress' });
    progress.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Bosh sahifa' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Bosh sahifa' })).toBeVisible();
  });

  it('wraps backward navigation from the first tab to the last', async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);
    const home = screen.getByRole('tab', { name: 'Bosh sahifa' });
    home.focus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Progress' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Progress' })).toBeVisible();
  });

  it('jumps to boundary tabs with Home and End', async () => {
    const user = userEvent.setup();
    render(<ShellHarness initialTab="tests" />);
    const tests = screen.getByRole('tab', { name: 'Testlar' });
    tests.focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Progress' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Bosh sahifa' })).toHaveFocus();
  });

  it('ignores unrelated keyboard input without changing the view', async () => {
    const user = userEvent.setup();
    render(<ShellHarness initialTab="tests" />);
    const tests = screen.getByRole('tab', { name: 'Testlar' });
    tests.focus();
    await user.keyboard('x');
    expect(tests).toHaveFocus();
    expect(tests).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Testlar' })).toBeVisible();
  });

  it('focuses main content after a pointer-style tab activation', async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);
    await user.click(screen.getByRole('tab', { name: 'Testlar' }));
    await waitFor(() => {
      expect(screen.getByRole('tabpanel')).toHaveFocus();
    });
  });

  it('exposes only one internal skip link and no external destination', () => {
    render(<ShellHarness />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '#tabpanel-home');
    expect(links[0]).not.toHaveAttribute('target');
  });

  it('uses a locale-specific accessible name for navigation', () => {
    const { rerender } = render(<ShellHarness locale="uz-Latn-UZ" />);
    expect(screen.getByRole('navigation')).toHaveAccessibleName('Onless Lite namoyishi');
    rerender(<ShellHarness locale="ru-RU" />);
    expect(screen.getByRole('navigation')).toHaveAccessibleName('Демонстрация Onless Lite');
  });

  it('cancels scheduled focus work when unmounted', async () => {
    const scheduled: FrameRequestCallback[] = [];
    const request = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        scheduled.push(callback);
        return 42;
      });
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const user = userEvent.setup();
    const { unmount } = render(<ShellHarness />);

    await user.click(screen.getByRole('tab', { name: 'Testlar' }));
    expect(request).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(1);
    unmount();
    expect(cancel).toHaveBeenCalledWith(42);
  });
});
