import { listProviders } from '../../providers/index.js';
import { capabilitiesFor } from '../../providers/capabilities.js';
import { sections as inboxSections } from './inbox.js';

/**
 * Report-section registry (v2.0). Extra sections come from feature modules (export/reportSections/<feature>.js,
 * `sections` export) and from enabled providers (`provider.reportSections`). htmlReport.js / xlsxReport.js append
 * the applicable ones after the built-in sections of client reports (monthly, weekly_client, custom).
 * A section applies when its template list contains the template, its `platforms` (if any) contains the account's
 * platform and its `capability` (if any) is true for that platform. sections[key] === false in the export params
 * disables it. See providers/types.js ReportSection.
 */
const FEATURE_SECTIONS = [inboxSections];

export function allReportSections() {
  const fromProviders = listProviders().flatMap((p) => (Array.isArray(p.reportSections) ? p.reportSections : []));
  const seen = new Set();
  return [...FEATURE_SECTIONS.flat(), ...fromProviders].filter((s) => {
    if (!s?.key || typeof s.html !== 'function' || seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
}

/** Sections applicable to one account (template + platform), in registry order. */
export function extraSectionsFor(template, platform, { sections = {} } = {}) {
  const caps = capabilitiesFor(platform);
  return allReportSections().filter((s) => (s.templates ?? []).includes(template)
    && (!s.platforms || s.platforms.includes(platform))
    && (!s.capability || !!caps[s.capability])
    && sections[s.key] !== false);
}

/** Renders the applicable sections' HTML for an account; a failing section is skipped (logged), never fatal. */
export function renderExtraSections(template, ctx, { sections = {} } = {}) {
  return extraSectionsFor(template, ctx.analysis.platform, { sections }).map((s) => {
    try { return s.html(ctx) ?? ''; } catch (e) { console.error(`[report:${s.key}]`, e); return ''; }
  }).join('');
}

/** xlsx sheets of the applicable sections for an account. */
export function extraSheetsFor(template, ctx, { sections = {} } = {}) {
  return extraSectionsFor(template, ctx.analysis.platform, { sections }).flatMap((s) => {
    if (typeof s.sheets !== 'function') return [];
    try { return s.sheets(ctx) ?? []; } catch (e) { console.error(`[report:${s.key}]`, e); return []; }
  });
}
