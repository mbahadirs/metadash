import { describe, it, expect, beforeEach } from 'vitest';
import { buildAnthropicRequest, createAnthropicProvider, supportsVision as anthropicVision } from '../src/main/ai/providers/anthropic.js';
import { buildOpenAIRequest, createOpenAIProvider, supportsVision as openaiVision } from '../src/main/ai/providers/openai.js';
import { buildGeminiRequest, createGeminiProvider, supportsVision as geminiVision } from '../src/main/ai/providers/gemini.js';
import { buildOllamaRequest, createOllamaProvider, supportsVision as ollamaVision } from '../src/main/ai/providers/ollama.js';
import { prepareImages, fitWithin, estimateImageTokens, VISION_DEFAULTS } from '../src/main/ai/vision.js';
import { parseOllamaShow, probeOllama, aiCapabilities, clearCapabilityCache } from '../src/main/ai/capabilities.js';
import { runStructured } from '../src/main/ai/structured.js';

const IMG = { mime: 'image/jpeg', data: 'QUJD', w: 800, h: 600 };

function fakeFetch(replies) {
  const log = [];
  let i = 0;
  const impl = async (url, init) => {
    log.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const [status, body] = replies[Math.min(i++, replies.length - 1)];
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { impl, log };
}

describe('provider request builders with images', () => {
  it('anthropic: base64 image blocks come before the text block', () => {
    const p = createAnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5', client: {} });
    const m = p.userMessage('describe', { images: [IMG] });
    expect(m).toEqual({ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
      { type: 'text', text: 'describe' },
    ] });
    expect(p.userMessage('plain')).toEqual({ role: 'user', content: 'plain' });
    const { params } = buildAnthropicRequest({ model: 'claude-sonnet-5', system: 's', messages: [m] });
    expect(params.messages[0].content[0].type).toBe('image');
  });

  it('openai: text part then image_url data URL parts', () => {
    const p = createOpenAIProvider({ apiKey: 'k', model: 'gpt-5-mini' });
    const m = p.userMessage('describe', { images: [IMG], detail: 'low' });
    expect(m).toEqual({ role: 'user', content: [
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD', detail: 'low' } },
    ] });
    const req = buildOpenAIRequest({ model: 'gpt-5-mini', system: 's', messages: [m] });
    expect(req.messages[1]).toEqual(m);
    expect(p.userMessage('x')).toEqual({ role: 'user', content: 'x' });
  });

  it('gemini: inline_data parts before the text part', () => {
    const p = createGeminiProvider({ apiKey: 'k', model: 'gemini-2.5-flash' });
    const m = p.userMessage('describe', { images: [IMG] });
    expect(m).toEqual({ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } }, { text: 'describe' }] });
    expect(buildGeminiRequest({ system: 's', messages: [m] }).contents[0]).toEqual(m);
  });

  it('ollama: images array of raw base64 on the user message', () => {
    const p = createOllamaProvider({ model: 'llava' });
    const m = p.userMessage('describe', { images: [IMG] });
    expect(m).toEqual({ role: 'user', content: 'describe', images: ['QUJD'] });
    expect(buildOllamaRequest({ model: 'llava', system: 's', messages: [m] }).messages[1]).toEqual(m);
    expect(p.userMessage('x')).toEqual({ role: 'user', content: 'x' });
  });

  it('text-only fallback: empty images keep the plain string shape everywhere', () => {
    expect(createAnthropicProvider({ apiKey: 'k', model: 'claude-haiku-4-5', client: {} }).userMessage('t', { images: [] })).toEqual({ role: 'user', content: 't' });
    expect(createGeminiProvider({ apiKey: 'k', model: 'g' }).userMessage('t', { images: [] })).toEqual({ role: 'user', parts: [{ text: 't' }] });
    expect(createOllamaProvider({ model: 'm' }).userMessage('t', { images: [] })).toEqual({ role: 'user', content: 't' });
  });

  it('supportsVision per provider', () => {
    for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) expect(anthropicVision(m)).toBe(true);
    expect(openaiVision('gpt-5-mini')).toBe(true);
    expect(openaiVision('gpt-4o-2024-08-06')).toBe(true);
    expect(openaiVision('o3-mini')).toBe(false);
    expect(openaiVision('my-finetune')).toBe('unknown');
    expect(geminiVision('gemini-2.5-flash')).toBe(true);
    expect(geminiVision('models/gemini-1.5-pro')).toBe(true);
    expect(geminiVision('text-bison')).toBe('unknown');
    expect(ollamaVision('llava:13b')).toBe(true);
    expect(ollamaVision('llama3.1')).toBe('unknown');
  });
});

describe('OpenAI image rejection → text-only retry', () => {
  it('retries once without images and reports visionDropped', async () => {
    const f = fakeFetch([
      [400, { error: { message: 'Invalid content type. image_url is only supported by certain models.' } }],
      [200, { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }],
    ]);
    const provider = createOpenAIProvider({ apiKey: 'k', model: 'my-finetune', fetchImpl: f.impl });
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    const res = await runStructured({ provider, system: 's', userText: 'u', images: [IMG], schema, modes: ['json'] });
    expect(res.data).toEqual({ ok: true });
    expect(res.visionDropped).toBe(true);
    expect(f.log).toHaveLength(2);
    expect(JSON.stringify(f.log[0].body)).toContain('image_url');
    expect(JSON.stringify(f.log[1].body)).not.toContain('image_url');
  });
});

describe('Ollama capability probe', () => {
  beforeEach(() => clearCapabilityCache());
  it('parses /api/show capabilities', () => {
    expect(parseOllamaShow({ capabilities: ['completion', 'vision', 'tools'] })).toEqual({ vision: true, tools: true });
    expect(parseOllamaShow({ capabilities: ['completion'] })).toEqual({ vision: false, tools: false });
    expect(parseOllamaShow({ details: {} })).toEqual({ vision: 'unknown', tools: 'unknown' });
    expect(parseOllamaShow(null)).toEqual({ vision: 'unknown', tools: 'unknown' });
  });
  it('POSTs {model} to /api/show once and caches per model', async () => {
    const f = fakeFetch([[200, { capabilities: ['completion', 'vision'] }]]);
    const a = await probeOllama('http://127.0.0.1:11434', 'gemma3', { fetchImpl: f.impl });
    const b = await probeOllama('http://127.0.0.1:11434', 'gemma3', { fetchImpl: f.impl });
    expect(a).toEqual({ vision: true, tools: false });
    expect(b).toEqual(a);
    expect(f.log).toHaveLength(1);
    expect(f.log[0].url).toBe('http://127.0.0.1:11434/api/show');
    expect(f.log[0].body).toEqual({ model: 'gemma3' });
  });
  it('probe failures degrade to unknown', async () => {
    const f = fakeFetch([[500, {}]]);
    expect(await probeOllama('http://x', 'm', { fetchImpl: f.impl })).toEqual({ vision: 'unknown', tools: 'unknown' });
  });
  it('aiCapabilities combines provider, probe and the user vision toggle', async () => {
    const f = fakeFetch([[200, { capabilities: ['completion', 'tools'] }]]);
    const caps = await aiCapabilities({ provider: 'ollama', model: 'qwen3', ollamaUrl: 'http://o' }, { fetchImpl: f.impl, allowVision: true });
    expect(caps).toMatchObject({ provider: 'ollama', vision: false, tools: true, local: true, structuredModes: ['tool', 'json'] });
    const anth = await aiCapabilities({ provider: 'anthropic', model: 'claude-opus-5' }, { allowVision: true });
    expect(anth).toMatchObject({ vision: true, tools: true, local: false, structuredModes: ['schema'] });
    const off = await aiCapabilities({ provider: 'anthropic', model: 'claude-opus-5' }, { allowVision: false });
    expect(off.vision).toBe(false);
    expect(off.visionDisabledByUser).toBe(true);
  });
});

describe('prepareImages', () => {
  /** Fake nativeImage: sizes come from the "file", JPEG size shrinks with quality and pixel count. */
  function fakeNative(sizes) {
    const make = (w, h) => ({
      isEmpty: () => w === 0,
      getSize: () => ({ width: w, height: h }),
      resize: ({ width, height }) => make(width, height),
      toJPEG: (q) => Buffer.alloc(Math.round((w * h * q) / 100)),
    });
    return { createFromPath: (p) => make(...(sizes[p] ?? [0, 0])), createFromBuffer: () => make(100, 100) };
  }

  it('fitWithin keeps aspect ratio and never upsizes', () => {
    expect(fitWithin(3000, 2000, 1568)).toEqual({ w: 1568, h: 1045 });
    expect(fitWithin(800, 600, 1568)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(1000, 4000, 1000)).toEqual({ w: 250, h: 1000 });
  });

  it('resizes to maxEdge, re-encodes as JPEG, enforces max count and byte budget', async () => {
    const nativeImage = fakeNative({ '/a.png': [4000, 3000], '/b.jpg': [800, 600], '/c.jpg': [500, 500] });
    const { images, skipped } = await prepareImages([{ path: '/a.png' }, { path: '/missing.jpg' }, { path: '/b.jpg' }, { path: '/c.jpg' }], { nativeImage, max: 2, maxBytes: 2_000_000 });
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ mime: 'image/jpeg', w: 1568, h: 1176 });
    expect(images[0].bytes).toBeLessThanOrEqual(2_000_000);
    expect(typeof images[0].data).toBe('string');
    expect(images[1]).toMatchObject({ w: 800, h: 600 });
    expect(skipped).toEqual([{ source: { path: '/missing.jpg' }, reason: 'unreadable' }, { source: { path: '/c.jpg' }, reason: 'over_limit' }]);
  });

  it('uses the thumbnail for video assets and resolves asset ids through the injected loader', async () => {
    const nativeImage = fakeNative({ '/thumbs/v.jpg': [240, 300], '/files/i.png': [1080, 1350] });
    const loadAsset = (id, variant) => (id === 1 ? { kind: 'video', filePath: variant === 'thumb' ? '/thumbs/v.jpg' : '/files/v.mp4' } : id === 2 ? { kind: 'image', filePath: '/files/i.png' } : null);
    const { images, skipped } = await prepareImages([1, { assetId: 2 }, 3], { nativeImage, loadAsset });
    expect(images.map((i) => [i.w, i.h])).toEqual([[240, 300], [1080, 1350]]);
    expect(images[0].source).toEqual({ kind: 'asset', id: 1, variant: 'thumb' });
    expect(skipped[0]).toMatchObject({ reason: 'not_found' });
  });

  it('drops an image that cannot be squeezed under maxBytes', async () => {
    const nativeImage = fakeNative({ '/huge.jpg': [1568, 1568] });
    const { images, skipped } = await prepareImages([{ path: '/huge.jpg' }], { nativeImage, maxBytes: 1000 });
    expect(images).toEqual([]);
    expect(skipped[0].reason).toBe('too_large');
  });

  it('defaults follow the plan', () => {
    expect(VISION_DEFAULTS).toMatchObject({ maxEdge: 1568, max: 4 });
  });

  it('estimates image tokens per provider', () => {
    expect(estimateImageTokens(1000, 1000, 'anthropic')).toBe(1334);
    expect(estimateImageTokens(512, 512, 'openai', { detail: 'low' })).toBe(85);
    expect(estimateImageTokens(1024, 1024, 'openai')).toBe(765);
    expect(estimateImageTokens(300, 300, 'gemini')).toBe(258);
    expect(estimateImageTokens(1000, 1000, 'gemini')).toBe(258 * 4);
  });
});
