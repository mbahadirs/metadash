/** White-label report branding: pure validation / normalisation (no Electron, no DB). */

export const DEFAULT_ACCENT = '#4F7CFF';
export const MAX_LOGO_BYTES = 1024 * 1024;
const NAME_MAX = 80;
const FOOTER_MAX = 240;

export const BRANDING_DEFAULTS = Object.freeze({ agencyName: '', logo: null, accent: DEFAULT_ACCENT, footerText: '', hideCredit: false });

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;
const SVG_DANGER = /<script|<foreignObject|javascript:|\son[a-z]+\s*=|<iframe|<embed|<object/i;

/** Byte signature check so a file cannot claim a different image type. */
const MAGIC = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG',
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  'image/svg+xml': (b) => { const s = b.toString('utf8'); return /<svg[\s>]/i.test(s) && !SVG_DANGER.test(s); },
};

/** '#abc' / '#AABBCC' → '#aabbcc'; anything else → null. */
export function normalizeHex(v) {
  if (typeof v !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/** Validates an image data URL (png/jpeg/webp/svg, ≤ MAX_LOGO_BYTES, matching bytes). */
export function checkLogo(dataUrl) {
  if (typeof dataUrl !== 'string') return { ok: false, error: 'logo_invalid' };
  const m = DATA_URL.exec(dataUrl);
  if (!m) return { ok: false, error: 'logo_invalid' };
  if ((m[2].length * 3) / 4 > MAX_LOGO_BYTES + 3) return { ok: false, error: 'logo_too_large' };
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: 'logo_too_large' };
  return MAGIC[m[1]](bytes) ? { ok: true, dataUrl } : { ok: false, error: 'logo_invalid' };
}

/** A valid logo data URL or null. */
export const safeLogo = (dataUrl) => (checkLogo(dataUrl).ok ? dataUrl : null);

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : ''); // eslint-disable-line no-control-regex

/** Normalises stored branding settings; invalid values fall back to defaults. */
export function resolveBranding(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    agencyName: cleanText(s.agencyName, NAME_MAX),
    logo: safeLogo(s.logo),
    accent: normalizeHex(s.accent) ?? DEFAULT_ACCENT,
    footerText: cleanText(s.footerText, FOOTER_MAX),
    hideCredit: s.hideCredit === true,
  };
}

/** Error keys (main i18n) for user input from the settings form; empty values are allowed. */
export function brandingErrors(input) {
  const s = input && typeof input === 'object' ? input : {};
  const errors = [];
  if (s.accent && !normalizeHex(s.accent)) errors.push('invalid_color');
  if (s.logo) { const r = checkLogo(s.logo); if (!r.ok) errors.push(r.error); }
  return errors;
}

/** True when anything visible differs from an unbranded report. */
export const hasBrandHeader = (b) => !!(b.agencyName || b.logo);
