import { describe, it, expect } from 'vitest';
import { PRICES, priceFor, estimateCost, sanitizePricingOverrides, listPrices } from '../src/main/ai/pricing.js';
import { estimateTextTokens, describeSend } from '../src/main/ai/preview.js';

describe('pricing table', () => {
  it('Anthropic list prices per 1M tokens are exact and verified', () => {
    expect(PRICES.anthropic['claude-opus-5']).toMatchObject({ inPerM: 5, outPerM: 25, status: 'verified' });
    expect(PRICES.anthropic['claude-sonnet-5']).toMatchObject({ inPerM: 2, outPerM: 10, status: 'verified' });
    expect(PRICES.anthropic['claude-haiku-4-5']).toMatchObject({ inPerM: 1, outPerM: 5, status: 'verified' });
  });
  it('other providers are marked as editable estimates', () => {
    for (const p of ['openai', 'gemini']) {
      for (const row of Object.values(PRICES[p])) expect(row.status).toBe('estimate');
    }
  });
});

describe('estimateCost', () => {
  it('computes input + output cost', () => {
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'anthropic', 'claude-opus-5')).toBe(30);
    expect(estimateCost({ inputTokens: 2000, outputTokens: 500 }, 'anthropic', 'claude-sonnet-5')).toBeCloseTo(0.009, 10);
    expect(estimateCost({ inputTokens: 1000, outputTokens: 1000 }, 'anthropic', 'claude-haiku-4-5')).toBeCloseTo(0.006, 10);
  });
  it('unknown model → null; missing usage counts as zero', () => {
    expect(estimateCost({ inputTokens: 10, outputTokens: 10 }, 'openai', 'totally-custom-model')).toBeNull();
    expect(estimateCost({ inputTokens: 10, outputTokens: 10 }, 'mystery', 'x')).toBeNull();
    expect(estimateCost(null, 'anthropic', 'claude-opus-5')).toBe(0);
  });
  it('matches dated / suffixed model names by longest prefix', () => {
    expect(priceFor('openai', 'gpt-5-mini-2025-08-07')).toMatchObject({ source: 'estimate' });
    expect(priceFor('openai', 'gpt-5-mini-2025-08-07').inPerM).toBe(PRICES.openai['gpt-5-mini'].inPerM);
    expect(priceFor('gemini', 'models/gemini-2.5-flash').inPerM).toBe(PRICES.gemini['gemini-2.5-flash'].inPerM);
  });
  it('user overrides win (exact or prefix) and make unknown models priceable', () => {
    const overrides = { openai: { 'totally-custom': { inPerM: 1, outPerM: 2 } }, anthropic: { 'claude-opus-5': { inPerM: 10, outPerM: 50 } } };
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 0 }, 'openai', 'totally-custom-model', overrides)).toBe(1);
    expect(priceFor('anthropic', 'claude-opus-5', overrides)).toEqual({ inPerM: 10, outPerM: 50, source: 'override' });
  });
  it('Ollama is local and always free', () => {
    expect(estimateCost({ inputTokens: 5e6, outputTokens: 5e6 }, 'ollama', 'llama3.1')).toBe(0);
    expect(priceFor('ollama', 'anything')).toEqual({ inPerM: 0, outPerM: 0, source: 'local' });
  });
  it('sanitizePricingOverrides keeps only known providers and finite non-negative prices', () => {
    expect(sanitizePricingOverrides({
      openai: { 'gpt-x': { inPerM: '1.5', outPerM: 3 }, bad: { inPerM: -1, outPerM: 2 }, nan: { inPerM: 'x', outPerM: 1 } },
      evil: { m: { inPerM: 1, outPerM: 1 } },
      ollama: { m: { inPerM: 1, outPerM: 1 } },
    })).toEqual({ openai: { 'gpt-x': { inPerM: 1.5, outPerM: 3 } } });
    expect(sanitizePricingOverrides('nope')).toEqual({});
  });
  it('listPrices merges table and overrides for the settings UI', () => {
    const rows = listPrices({ openai: { 'gpt-x': { inPerM: 1, outPerM: 2 } } });
    expect(rows.find((r) => r.provider === 'openai' && r.model === 'gpt-x')).toMatchObject({ source: 'override' });
    expect(rows.find((r) => r.model === 'claude-opus-5')).toMatchObject({ inPerM: 5, outPerM: 25, source: 'list' });
  });
});

describe('preview estimates', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('abcd')).toBe(1);
    expect(estimateTextTokens('abcde')).toBe(2);
  });
  it('describeSend runs the feature builder and adds token + cost estimates without calling a model', async () => {
    const previews = {
      demo: async (params) => ({
        items: [{ kind: 'text', label: 'brief', chars: 400 }, { kind: 'image', label: 'img', count: 1 }],
        text: 'x'.repeat(400 + params.extra),
        images: [{ w: 1000, h: 1000 }],
        expectedOutputTokens: 1000,
      }),
    };
    const out = await describeSend('demo', { extra: 0 }, { previews, provider: 'anthropic', model: 'claude-sonnet-5', overrides: {} });
    expect(out.items).toHaveLength(2);
    expect(out.estInputTokens).toBe(100 + 1334);
    expect(out.estOutputTokens).toBe(1000);
    expect(out.estCostUsd).toBeCloseTo((1434 * 2 + 1000 * 10) / 1e6, 10);
    const local = await describeSend('demo', { extra: 0 }, { previews, provider: 'ollama', model: 'llava', overrides: {} });
    expect(local).toMatchObject({ estCostUsd: 0, local: true });
    await expect(describeSend('nope', {}, { previews, provider: 'anthropic', model: 'claude-opus-5' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});
