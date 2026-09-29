import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { getSetting } from '../src/main/db/queries/settings.js';
import { reportCommentary, explainAnomaly, testConnection } from '../src/main/ai/service.js';
import { aiStatus, updateAiConfig, saveApiKey, readApiKey } from '../src/main/ai/settings.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-ai-svc-'));
beforeAll(() => { openDb(path.join(dir, 'data.db')); });
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('AI service gating and settings', () => {
  it('is off by default and every provider call refuses with ai_off', async () => {
    expect(aiStatus().enabled).toBe(false);
    await expect(reportCommentary({ template: 'portfolio' })).rejects.toMatchObject({ key: 'ai_off' });
    await expect(explainAnomaly({ igId: 'x', date: '2026-01-01', kind: 'reach' })).rejects.toMatchObject({ key: 'ai_off' });
    await expect(testConnection()).rejects.toMatchObject({ key: 'ai_off' });
  });

  it('requires a key for hosted providers once enabled', async () => {
    updateAiConfig({ enabled: true, provider: 'anthropic' });
    await expect(testConnection()).rejects.toMatchObject({ key: 'ai_no_key' });
  });

  it('stores keys encrypted and only exposes last 4 characters', () => {
    saveApiKey('anthropic', '  sk-ant-secret-WXYZ  ');
    const raw = getSetting('token:ai:anthropic');
    expect(raw).toMatch(/^gcm:/);
    expect(raw).not.toContain('secret');
    expect(readApiKey('anthropic')).toBe('sk-ant-secret-WXYZ');
    const status = aiStatus();
    expect(status.keys.anthropic).toEqual({ set: true, last4: 'WXYZ' });
    expect(JSON.stringify(status)).not.toContain('secret');
    saveApiKey('anthropic', '');
    expect(aiStatus().keys.anthropic.set).toBe(false);
    expect(() => saveApiKey('ollama', 'x')).toThrow();
  });

  it('resets the model when switching provider and validates patches', () => {
    updateAiConfig({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(aiStatus().model).toBe('claude-haiku-4-5');
    expect(updateAiConfig({ provider: 'openai' }).model).toBe('gpt-5-mini');
    expect(() => updateAiConfig({ ollamaUrl: 'javascript:alert(1)' })).toThrow();
    updateAiConfig({ enabled: false });
  });
});
