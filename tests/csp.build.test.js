import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { stripDevCsp } from '../vite.config.ts';

describe('production CSP', () => {
  it('removes the Vite dev-server origins from connect-src and leaves the rest untouched', () => {
    const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    expect(html).toContain('ws://localhost:5173'); // dev keeps HMR
    const out = stripDevCsp(html);
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(out)[1];
    expect(csp).not.toMatch(/localhost:5173/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(out.replace(csp, '')).toBe(html.replace(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)[1], ''));
  });
});
