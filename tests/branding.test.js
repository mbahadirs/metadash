import { describe, it, expect } from 'vitest';
import { resolveBranding, normalizeHex, checkLogo, brandingErrors, BRANDING_DEFAULTS, MAX_LOGO_BYTES, DEFAULT_ACCENT } from '../src/main/export/branding.js';
import { recolorAccent, brandBar, footerHtml } from '../src/main/export/brandingHtml.js';
import { tableHtml } from '../src/main/export/tableHtml.js';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const png = `data:image/png;base64,${PNG_1PX}`;
const svg = (body) => `data:image/svg+xml;base64,${Buffer.from(body).toString('base64')}`;

describe('resolveBranding', () => {
  it('returns defaults for missing / garbage input', () => {
    expect(resolveBranding()).toEqual(BRANDING_DEFAULTS);
    expect(resolveBranding(null)).toEqual(BRANDING_DEFAULTS);
    expect(resolveBranding('x')).toEqual(BRANDING_DEFAULTS);
    expect(BRANDING_DEFAULTS.accent).toBe(DEFAULT_ACCENT);
  });
  it('keeps valid values, trims and caps text', () => {
    const b = resolveBranding({ agencyName: '  Acme Agency ', accent: '#0A0', footerText: 'acme.io', hideCredit: true, logo: png });
    expect(b).toEqual({ agencyName: 'Acme Agency', accent: '#00aa00', footerText: 'acme.io', hideCredit: true, logo: png });
    expect(resolveBranding({ agencyName: 'x'.repeat(500) }).agencyName).toHaveLength(80);
    expect(resolveBranding({ hideCredit: 'yes' }).hideCredit).toBe(false);
  });
  it('rejects invalid hex colours', () => {
    for (const bad of ['red', '#12345', '#GGGGGG', '123456', 'url(x)', '#fff;}body{', 42]) expect(resolveBranding({ accent: bad }).accent).toBe(DEFAULT_ACCENT);
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('nope')).toBeNull();
  });
  it('rejects oversize, wrong-type and mislabelled logos', () => {
    const big = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG_1PX, 'base64'), Buffer.alloc(MAX_LOGO_BYTES)]).toString('base64')}`;
    expect(checkLogo(big)).toEqual({ ok: false, error: 'logo_too_large' });
    expect(resolveBranding({ logo: big }).logo).toBeNull();
    expect(checkLogo('data:image/gif;base64,R0lGODlhAQABAAAAACw=').ok).toBe(false);
    expect(checkLogo(`data:image/jpeg;base64,${PNG_1PX}`).ok).toBe(false); // PNG bytes labelled as JPEG
    expect(checkLogo('javascript:alert(1)').ok).toBe(false);
    expect(checkLogo('data:image/png;base64,"><script>').ok).toBe(false);
    expect(checkLogo(png).ok).toBe(true);
  });
  it('accepts plain SVG, rejects scripted SVG', () => {
    expect(checkLogo(svg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')).ok).toBe(true);
    expect(checkLogo(svg('<svg><script>alert(1)</script></svg>')).ok).toBe(false);
    expect(checkLogo(svg('<svg onload="alert(1)"></svg>')).ok).toBe(false);
    expect(checkLogo(svg('<svg><a href="javascript:alert(1)"/></svg>')).ok).toBe(false);
    expect(checkLogo(svg('<html>not svg</html>')).ok).toBe(false);
  });
  it('reports input errors for the settings form', () => {
    expect(brandingErrors({ accent: '#123456', logo: png })).toEqual([]);
    expect(brandingErrors({ accent: 'blue' })).toEqual(['invalid_color']);
    expect(brandingErrors({ logo: 'data:image/png;base64,AAAA' })).toEqual(['logo_invalid']);
    expect(brandingErrors({ accent: '', logo: null })).toEqual([]);
  });
});

describe('branding HTML helpers', () => {
  it('escapes agency name and footer text', () => {
    const b = resolveBranding({ agencyName: '<b>Acme</b>', footerText: '"x" & <y>' });
    expect(brandBar(b, null)).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(footerHtml(b, 'Generated with MetaDash')).toContain('&quot;x&quot; &amp; &lt;y&gt;');
  });
  it('shows or hides the credit line', () => {
    expect(footerHtml(resolveBranding({}), 'Generated with MetaDash', 'Generated')).toContain('MetaDash');
    expect(footerHtml(resolveBranding({ hideCredit: true }), 'Generated with MetaDash', 'Generated')).not.toContain('MetaDash');
  });
  it('recolours the default accent in charts', () => {
    const out = recolorAccent('<path stroke="#4F7CFF"/><rect fill="rgba(79,124,255,0.5)"/>', '#ff0000');
    expect(out).toBe('<path stroke="#ff0000"/><rect fill="rgba(255,0,0,0.5)"/>');
    expect(recolorAccent('<p stroke="#4F7CFF">', DEFAULT_ACCENT)).toBe('<p stroke="#4F7CFF">');
  });
  it('table PDF HTML carries branding and hides the credit', () => {
    const sheets = [{ name: 'S', columns: [{ key: 'a', label: 'A', type: 'text' }], rows: [{ a: '<x>' }] }];
    const plain = tableHtml({ title: 'T', sheets, lang: 'en' });
    expect(plain).toContain('MetaDash');
    const html = tableHtml({ title: 'T', sheets, lang: 'en', branding: resolveBranding({ agencyName: 'Acme', footerText: 'acme.io', hideCredit: true, logo: png, accent: '#112233' }) });
    expect(html).toContain('Acme');
    expect(html).toContain('acme.io');
    expect(html).toContain(`src="${png}"`);
    expect(html).toContain('#112233');
    expect(html).not.toContain('MetaDash');
    expect(html).toContain('&lt;x&gt;');
  });
});
