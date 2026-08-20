import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TelegramLiteDashboard } from '../src/dashboard/dashboard.js';
import type {
  DashboardDataSource,
  DashboardSnapshot,
} from '../src/domain/contracts.js';
import {
  DEMO_DASHBOARD_SNAPSHOT,
  FixtureDashboardDataSource,
} from '../src/demo/fixture-data-source.js';

class RejectedDataSource implements DashboardDataSource {
  public calls = 0;

  public load(): Promise<DashboardSnapshot> {
    this.calls += 1;
    return Promise.reject(new Error('private failure detail'));
  }
}

function sourceWith(snapshot: DashboardSnapshot): DashboardDataSource {
  return { load: () => Promise.resolve(snapshot) };
}

describe('TelegramLiteDashboard', () => {
  it('announces initial loading and renders a localized home summary', async () => {
    render(
      <TelegramLiteDashboard
        dataSource={new FixtureDashboardDataSource()}
        locale="uz-Latn-UZ"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Namoyish ma’lumotlari');

    expect(await screen.findByRole('heading', { name: 'Salom, Demo' })).toBeVisible();
    expect(screen.getByText('Yakunlangan testlar')).toBeVisible();
    expect(screen.getByText('Oxirgi natijalar')).toBeVisible();
    expect(screen.getByText('Demo test natijasi')).toBeVisible();
    expect(screen.queryByText('private failure detail')).not.toBeInTheDocument();
  });

  it('keeps all public views read-only while switching tabs', async () => {
    const user = userEvent.setup();
    render(
      <TelegramLiteDashboard
        dataSource={new FixtureDashboardDataSource()}
        locale="uz-Latn-UZ"
      />,
    );
    await screen.findByRole('heading', { name: 'Salom, Demo' });

    await user.click(screen.getByRole('tab', { name: 'Testlar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Testlar' })).toBeVisible();
    expect(screen.getByText('Jami savollar: 120')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.getByRole('heading', { name: 'Bilet 1' })).toBeVisible();
    expect(screen.getAllByText(/Mavjud/u)).toHaveLength(4);
    expect(screen.getAllByText('Yopiq')).toHaveLength(2);

    const interactive = screen.getAllByRole('tab');
    expect(interactive).toHaveLength(3);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', '#tabpanel-tests');

    await user.click(screen.getByRole('tab', { name: 'Progress' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '302');
    expect(screen.getAllByText('84%').length).toBeGreaterThanOrEqual(2);
  });

  it('supports roving keyboard navigation across the three tabs', async () => {
    const user = userEvent.setup();
    render(
      <TelegramLiteDashboard
        dataSource={new FixtureDashboardDataSource()}
        locale="uz-Latn-UZ"
      />,
    );
    await screen.findByRole('heading', { name: 'Salom, Demo' });
    const home = screen.getByRole('tab', { name: 'Bosh sahifa' });
    const tests = screen.getByRole('tab', { name: 'Testlar' });
    const progress = screen.getByRole('tab', { name: 'Progress' });

    home.focus();
    await user.keyboard('{ArrowRight}');
    expect(tests).toHaveFocus();
    expect(tests).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(progress).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(home).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(progress).toHaveFocus();
  });

  it('moves focus to main content after pointer tab activation and skip navigation', async () => {
    const user = userEvent.setup();
    render(
      <TelegramLiteDashboard
        dataSource={new FixtureDashboardDataSource()}
        locale="uz-Latn-UZ"
      />,
    );
    await screen.findByRole('heading', { name: 'Salom, Demo' });
    const main = screen.getByRole('main');

    await user.click(screen.getByRole('tab', { name: 'Testlar' }));
    await waitFor(() => { expect(screen.getByRole('tabpanel')).toHaveFocus(); });
    await user.click(screen.getByRole('link', { name: 'Asosiy mazmunga o‘tish' }));
    await waitFor(() => { expect(screen.getByRole('tabpanel')).toHaveFocus(); });
    expect(main).toContainElement(screen.getByRole('tabpanel'));
  });

  it('formats Russian copy, dates, and values with an explicit locale and UTC zone', async () => {
    render(
      <TelegramLiteDashboard
        dataSource={new FixtureDashboardDataSource()}
        locale="ru-RU"
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Demo' })).toBeVisible();
    expect(screen.getByText('Завершённые тесты')).toBeVisible();
    expect(screen.getByText(/31 июл\. 2026 г\./u)).toBeVisible();
    expect(screen.getByText(/Время демонстрации:/u)).toHaveTextContent('UTC');
    expect(screen.getByRole('navigation')).toHaveAccessibleName('Демонстрация Onless Lite');
  });

  it('presents an empty result state without inventing an action', async () => {
    const snapshot: DashboardSnapshot = {
      ...DEMO_DASHBOARD_SNAPSHOT,
      summary: { ...DEMO_DASHBOARD_SNAPSHOT.summary, recentResults: [] },
    };
    render(<TelegramLiteDashboard dataSource={sourceWith(snapshot)} locale="uz-Latn-UZ" />);
    expect(await screen.findByText('Hali namoyish natijalari yo‘q.')).toBeVisible();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('announces a safe failure and retries without exposing error details', async () => {
    const user = userEvent.setup();
    const source = new RejectedDataSource();
    render(<TelegramLiteDashboard dataSource={source} locale="uz-Latn-UZ" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Namoyish ma’lumotlarini ko‘rsatib bo‘lmadi.');
    expect(alert).not.toHaveTextContent('private failure detail');
    await user.click(within(alert).getByRole('button', { name: 'Qayta urinish' }));
    await waitFor(() => { expect(source.calls).toBe(2); });
  });

  it('never invokes browser networking while rendering or navigating', async () => {
    const network = vi.fn(() => Promise.reject(new Error('network must remain disabled')));
    vi.stubGlobal('fetch', network);
    const user = userEvent.setup();
    render(
      <TelegramLiteDashboard
        dataSource={new FixtureDashboardDataSource()}
        locale="uz-Latn-UZ"
      />,
    );
    await screen.findByRole('heading', { name: 'Salom, Demo' });
    await user.click(screen.getByRole('tab', { name: 'Testlar' }));
    await user.click(screen.getByRole('tab', { name: 'Progress' }));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => { expect(screen.getByRole('heading', { name: 'Progress' })).toBeVisible(); });
    expect(network).not.toHaveBeenCalled();
  });
});
