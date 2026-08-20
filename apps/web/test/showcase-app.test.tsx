import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShowcaseApp } from '../src/showcase/app';

const showcaseCss = readFileSync(
  join(process.cwd(), 'src/showcase/showcase.css'),
  'utf8',
);
const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

describe('ShowcaseApp product story', () => {
  it('leads with the problem and the complete learning loop', () => {
    render(<ShowcaseApp />);

    expect(
      screen.getByRole('heading', {
        name: /Tayyorlanishni aniq yo'lga aylantiramiz/u,
      }),
    ).toBeVisible();
    expect(screen.getByText("Holatni aniqlash")).toBeVisible();
    expect(screen.getByText("Keyingi qadam")).toBeVisible();
    expect(screen.getByText('Offline mashq')).toBeVisible();
    expect(screen.getByText('Natijani tahlil qilish')).toBeVisible();
  });

  it.each([
    ['Web', 'Asosiy o‘quv tajribasi'],
    ['Mobile', 'Offline-first yadro'],
    ['Telegram Lite', 'Yengil kuzatuv'],
    ['Desktop', 'Sinf protokoli'],
  ])('explains the %s client responsibility', (client, responsibility) => {
    render(<ShowcaseApp />);
    expect(screen.getByRole('heading', { name: client })).toBeVisible();
    expect(screen.getByText(responsibility)).toBeVisible();
  });

  it('distinguishes the fixture showcase from the complete product', async () => {
    const user = userEvent.setup();
    render(<ShowcaseApp />);
    expect(screen.getByText('Fixture-only demo')).toBeVisible();
    await user.click(
      screen.getByText("Bu ochiq repozitoriy to'liq Onless mahsulotimi?"),
    );
    expect(
      screen.getByText(/tanlangan, ishga tushadigan va sintetik/u),
    ).toBeVisible();
    expect(
      screen.getByText(/To'liq mahsulot alohida yopiq repozitoriyda/u),
    ).toBeVisible();
  });

  it('publishes the architectural dependency direction', () => {
    render(<ShowcaseApp />);
    const flow = screen.getByLabelText('Dastur qatlamlari');
    expect(flow).toHaveTextContent('Presentation');
    expect(flow).toHaveTextContent('Domain');
    expect(flow).toHaveTextContent('Ports');
    expect(flow).toHaveTextContent('Adapters');
  });

  it('announces roadmap activation without moving focus', async () => {
    const user = userEvent.setup();
    render(<ShowcaseApp />);
    const active = screen.getByRole('button', { name: /Mustaqil mashq/u });
    active.focus();

    await user.keyboard('{Enter}');

    expect(active).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Mustaqil mashq bosqichi tanlandi.',
    );
  });

  it('keeps navigation local except for the explicit contact address', () => {
    const { container } = render(<ShowcaseApp />);
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a'));

    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^(#|mailto:s\.yoqubov@onless\.uz$)/u);
    }
  });

  it('ships system fonts and a reduced-motion fallback', () => {
    expect(showcaseCss).not.toMatch(/@import|url\s*\(/u);
    expect(showcaseCss).toContain('ui-sans-serif');
    expect(showcaseCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(showcaseCss).toContain('scroll-behavior: auto !important');
  });

  it('enforces a browser-level no-connect policy', () => {
    expect(indexHtml).toContain("connect-src 'none'");
    expect(indexHtml).toContain("form-action 'none'");
    expect(indexHtml).toContain('content="no-referrer"');
    expect(indexHtml).not.toMatch(/https?:\/\//u);
  });
});

describe('ShowcaseApp network isolation', () => {
  const fetchSpy = vi.fn();
  const xhrOpenSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
  const webSocketSpy = vi.fn();
  const eventSourceSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockClear();
    xhrOpenSpy.mockClear();
    webSocketSpy.mockClear();
    eventSourceSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', webSocketSpy);
    vi.stubGlobal('EventSource', eventSourceSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders all product slices without opening a network channel', () => {
    const { container } = render(<ShowcaseApp />);

    expect(screen.getByRole('heading', { name: /o'rganish yo'li/iu })).toBeVisible();
    expect(screen.getByRole('heading', { name: /natijasini tahlil/iu })).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy).not.toHaveBeenCalled();
    expect(webSocketSpy).not.toHaveBeenCalled();
    expect(eventSourceSpy).not.toHaveBeenCalled();
    expect(container.querySelector('img, video, iframe, script[src^="http"]')).toBeNull();
  });

  it('remains isolated after roadmap and FAQ interactions', async () => {
    const user = userEvent.setup();
    render(<ShowcaseApp />);

    await user.click(screen.getByRole('button', { name: /Mustaqil mashq/u }));
    await user.click(
      screen.getByText("Demo serverga yoki ishlab turgan akkauntga ulanadimi?"),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpenSpy).not.toHaveBeenCalled();
    expect(webSocketSpy).not.toHaveBeenCalled();
    expect(eventSourceSpy).not.toHaveBeenCalled();
  });

  it('contains no storage, cookie, analytics, or API controls', () => {
    render(<ShowcaseApp />);
    const documentText = document.body.textContent;
    expect(documentText).not.toMatch(/login|password|checkout|payment|analytics/iu);
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('input, textarea, select')).toBeNull();
  });
});
