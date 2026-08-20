import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TelegramLiteDashboard } from '../dashboard/dashboard.js';
import { FixtureDashboardDataSource } from './fixture-data-source.js';

const dataSource = new FixtureDashboardDataSource();
const container = document.querySelector<HTMLDivElement>('#root');

if (!container) {
  throw new Error('Telegram Lite demo root is missing');
}

document.documentElement.lang = 'uz-Latn-UZ';

createRoot(container).render(
  <StrictMode>
    <TelegramLiteDashboard dataSource={dataSource} locale="uz-Latn-UZ" />
  </StrictMode>,
);
