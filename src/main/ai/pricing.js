/**
 * Token prices in USD per 1M tokens: { provider: { modelOrPrefix: { inPerM, outPerM, status } } }.
 * - status 'verified': Anthropic first-party list prices (claude-api reference, cached 2026-06-24; re-check on model changes).
 *   Thinking tokens are billed as output and are already included in output_tokens.
 * - status 'estimate': OpenAI / Gemini prices change often and were NOT verified at implementation time — they are
 *   editable in Settings → AI (stored in 'ai.pricing') and shown as "estimate" in the UI. VERIFY against the provider
 *   pricing pages before relying on them. Gemini prices are the ≤200k-context tier.
 * - Ollama runs locally: always 0.
 * Keys match the exact model id or, failing that, the longest key that is a prefix of it (dated snapshots, suffixes).
 */
export const PRICES = Object.freeze({
  anthropic: {
    'claude-opus-5': { inPerM: 5, outPerM: 25, status: 'verified' },
    'claude-sonnet-5': { inPerM: 2, outPerM: 10, status: 'verified' },
    'claude-haiku-4-5': { inPerM: 1, outPerM: 5, status: 'verified' },
  },
  openai: {
    'gpt-5': { inPerM: 1.25, outPerM: 10, status: 'estimate' },
    'gpt-5-mini': { inPerM: 0.25, outPerM: 2, status: 'estimate' },
    'gpt-5-nano': { inPerM: 0.05, outPerM: 0.4, status: 'estimate' },
    'gpt-4.1': { inPerM: 2, outPerM: 8, status: 'estimate' },
    'gpt-4.1-mini': { inPerM: 0.4, outPerM: 1.6, status: 'estimate' },
    'gpt-4.1-nano': { inPerM: 0.1, outPerM: 0.4, status: 'estimate' },
    'gpt-4o': { inPerM: 2.5, outPerM: 10, status: 'estimate' },
    'gpt-4o-mini': { inPerM: 0.15, outPerM: 0.6, status: 'estimate' },
  },
  gemini: {
    'gemini-2.5-pro': { inPerM: 1.25, outPerM: 10, status: 'estimate' },
    'gemini-2.5-flash': { inPerM: 0.3, outPerM: 2.5, status: 'estimate' },
    'gemini-2.5-flash-lite': { inPerM: 0.1, outPerM: 0.4, status: 'estimate' },
  },
});

export const PRICED_PROVIDERS = ['anthropic', 'openai', 'gemini'];
const LOCAL_PROVIDERS = new Set(['ollama']);
const MODEL_KEY_MAX = 100;
const PRICE_MAX = 10_000;

const cleanModel = (model) => String(model ?? '').trim().toLowerCase().replace(/^models\//, '');

/** Exact key, else the longest key that prefixes the model id. */
function lookup(table, model) {
  if (!table) return null;
  const m = cleanModel(model);
  if (table[m]) return table[m];
  const key = Object.keys(table).filter((k) => m.startsWith(k.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  return key ? table[key] : null;
}

/** { inPerM, outPerM, source: 'override' | 'list' | 'estimate' | 'local' } or null when the price is unknown. */
export function priceFor(provider, model, overrides = {}) {
  if (LOCAL_PROVIDERS.has(provider)) return { inPerM: 0, outPerM: 0, source: 'local' };
  const own = lookup(overrides?.[provider], model);
  if (own) return { inPerM: own.inPerM, outPerM: own.outPerM, source: 'override' };
  const row = lookup(PRICES[provider], model);
  if (!row) return null;
  return { inPerM: row.inPerM, outPerM: row.outPerM, source: row.status === 'verified' ? 'list' : 'estimate' };
}

/** Estimated USD for a usage { inputTokens, outputTokens }; null when the model's price is unknown; 0 for Ollama. */
export function estimateCost(usage, provider, model, overrides = {}) {
  const price = priceFor(provider, model, overrides);
  if (!price) return null;
  const input = Number(usage?.inputTokens) || 0;
  const output = Number(usage?.outputTokens) || 0;
  return (input * price.inPerM + output * price.outPerM) / 1_000_000;
}

const validPrice = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= PRICE_MAX ? n : null;
};

/** Validates the 'ai.pricing' setting: { provider: { model: { inPerM, outPerM } } } for priced providers only. */
export function sanitizePricingOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const provider of PRICED_PROVIDERS) {
    const rows = value[provider];
    if (!rows || typeof rows !== 'object') continue;
    const clean = {};
    for (const [model, p] of Object.entries(rows)) {
      const key = cleanModel(model).slice(0, MODEL_KEY_MAX);
      const inPerM = validPrice(p?.inPerM);
      const outPerM = validPrice(p?.outPerM);
      if (key && inPerM != null && outPerM != null) clean[key] = { inPerM, outPerM };
    }
    if (Object.keys(clean).length) out[provider] = clean;
  }
  return out;
}

/** Table + overrides as rows for Settings → AI: [{ provider, model, inPerM, outPerM, source }]. */
export function listPrices(overrides = {}) {
  const rows = [];
  for (const provider of PRICED_PROVIDERS) {
    const own = overrides?.[provider] ?? {};
    for (const [model, p] of Object.entries(PRICES[provider])) {
      if (own[model]) continue;
      rows.push({ provider, model, inPerM: p.inPerM, outPerM: p.outPerM, source: p.status === 'verified' ? 'list' : 'estimate' });
    }
    for (const [model, p] of Object.entries(own)) rows.push({ provider, model, inPerM: p.inPerM, outPerM: p.outPerM, source: 'override' });
  }
  return rows;
}
