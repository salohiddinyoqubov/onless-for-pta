import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('public Mini App security boundary', () => {
  it('ships an explicit deny-by-default content security policy', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("frame-ancestors 'none'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain('name="referrer" content="no-referrer"');
  });

  it('configures matching development and preview response headers', () => {
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(config).toContain('server: { headers: securityHeaders }');
    expect(config).toContain('preview: { headers: securityHeaders }');
    expect(config).toContain("'X-Frame-Options': 'DENY'");
    expect(config).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('contains no network, persistence, remote URL, or denied workflow primitive', () => {
    const content = sourceFiles(resolve(process.cwd(), 'src'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const denied = [
      /\bfetch\s*\(/u,
      /XMLHttpRequest/u,
      /WebSocket/u,
      /\blocalStorage\b/u,
      /\bsessionStorage\b/u,
      /https?:\/\//u,
      /\bcheckout\b/iu,
      /\bpayment\b/iu,
      /\bpayme\b/iu,
      /\botp\b/iu,
      /\bpassword\b/iu,
      /\binitData\b/u,
      /\bauth(?:entication)?\b/iu,
      /window\.location/u,
    ];
    for (const pattern of denied) expect(content).not.toMatch(pattern);
  });

  it('includes reduced-motion and keyboard-visible focus safeguards', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/dashboard/dashboard.css'),
      'utf8',
    );
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.spinner\s*\{[\s\S]*?animation:\s*none;/u,
    );
    expect(css).not.toContain('animation-duration');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('min-width: 44px');
    expect(css).toContain('min-height: 50px');
  });
});
