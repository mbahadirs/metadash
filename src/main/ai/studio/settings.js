import { getConfig, setConfig } from '../../config/store.js';
import { AiError } from '../errors.js';
import { sanitizePricingOverrides, listPrices } from '../pricing.js';

/** Studio / cost settings exposed to Settings → AI (studio:settings:get / studio:settings:set). */
const LANGS = ['tr', 'en'];
const BUDGET_MAX = 100_000;

const FIELDS = {
  keepHistory: { key: 'ai.keepHistory', clean: (v) => v === true },
  showCost: { key: 'ai.showCost', clean: (v) => v !== false },
  vision: { key: 'ai.vision', clean: (v) => v !== false },
  pricing: { key: 'ai.pricing', clean: (v) => sanitizePricingOverrides(v) },
  monthlyBudgetUsd: { key: 'ai.monthlyBudgetUsd', clean: cleanBudget },
  anonymizeCommenters: { key: 'studio.anonymizeCommenters', clean: (v) => v !== false },
  captionLangs: { key: 'studio.captionLangs', clean: cleanLangs },
};

function cleanBudget(v) {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > BUDGET_MAX) throw new AiError('ai_bad_input', { vars: { field: 'monthlyBudgetUsd' } });
  return n === 0 ? null : Math.round(n * 100) / 100;
}

function cleanLangs(v) {
  const langs = [...new Set((Array.isArray(v) ? v : []).filter((l) => LANGS.includes(l)))];
  if (!langs.length) throw new AiError('ai_bad_input', { vars: { field: 'captionLangs' } });
  return langs;
}

export function readStudioSettings() {
  const out = Object.fromEntries(Object.entries(FIELDS).map(([name, f]) => [name, getConfig(f.key)]));
  return { ...out, pricing: sanitizePricingOverrides(out.pricing), prices: listPrices(sanitizePricingOverrides(out.pricing)) };
}

/** Validates and applies a partial patch; unknown fields are rejected. Returns the new settings. */
export function updateStudioSettings(patch = {}) {
  if (!patch || typeof patch !== 'object') throw new AiError('ai_bad_input', { vars: { field: 'patch' } });
  const entries = Object.entries(patch).map(([name, value]) => {
    const f = FIELDS[name];
    if (!f) throw new AiError('ai_bad_input', { vars: { field: name } });
    return [f.key, f.clean(value)];
  });
  for (const [k, v] of entries) setConfig(k, v);
  return readStudioSettings();
}
