import { supportsVision as anthropicVision } from './providers/anthropic.js';
import { supportsVision as openaiVision } from './providers/openai.js';
import { supportsVision as geminiVision } from './providers/gemini.js';
import { supportsVision as ollamaVision } from './providers/ollama.js';
import { DEFAULT_OLLAMA_URL } from './models.js';

const PROBE_TIMEOUT_MS = 5_000;
const FAILED_PROBE_TTL_MS = 60_000;
const UNKNOWN = Object.freeze({ vision: 'unknown', tools: 'unknown' });

/** Ollama probe cache: `${baseUrl}|${model}` → { value, expiresAt } (successful probes never expire this session). */
const cache = new Map();

export function clearCapabilityCache() {
  cache.clear();
}

/**
 * Parses POST /api/show. Recent Ollama versions return `capabilities: ['completion', 'vision', 'tools', …]`
 * (VERIFY on the minimum supported Ollama version); older servers omit the field → 'unknown'.
 */
export function parseOllamaShow(body) {
  const caps = body?.capabilities;
  if (!Array.isArray(caps)) return { ...UNKNOWN };
  return { vision: caps.includes('vision'), tools: caps.includes('tools') };
}

export async function probeOllama(baseUrl, model, { fetchImpl = fetch } = {}) {
  const key = `${baseUrl}|${model}`;
  const hit = cache.get(key);
  if (hit && (!hit.expiresAt || hit.expiresAt > Date.now())) return hit.value;
  let value = { ...UNKNOWN };
  let ok = false;
  try {
    const res = await fetchImpl(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) { value = parseOllamaShow(await res.json()); ok = true; }
  } catch {
    // unreachable server → unknown; the real call will surface a proper error
  }
  cache.set(key, { value, expiresAt: ok ? 0 : Date.now() + FAILED_PROBE_TTL_MS });
  return value;
}

const VISION_BY_PROVIDER = { anthropic: anthropicVision, openai: openaiVision, gemini: geminiVision, ollama: ollamaVision };

/**
 * What the configured model can do. vision: true | false | 'unknown' ('unknown' → try, and on an image rejection retry
 * text-only). allowVision=false (Settings → AI "Send images") forces vision off. structuredModes is the order
 * runStructured tries: Anthropic uses native structured outputs, the others a forced tool then JSON mode.
 * probe=false skips the Ollama /api/show request (used while AI is off: nothing touches the network).
 */
export async function aiCapabilities(cfg, { fetchImpl, allowVision = true, probe = true } = {}) {
  const { provider, model } = cfg;
  const local = provider === 'ollama';
  let vision = VISION_BY_PROVIDER[provider]?.(model) ?? 'unknown';
  let tools = local ? 'unknown' : true;
  if (local && probe) {
    const found = await probeOllama(cfg.ollamaUrl || DEFAULT_OLLAMA_URL, model, { fetchImpl });
    if (found.vision !== 'unknown') vision = found.vision;
    tools = found.tools;
  }
  const structuredModes = provider === 'anthropic' ? ['schema'] : tools === false ? ['json'] : ['tool', 'json'];
  return {
    provider,
    model,
    vision: allowVision ? vision : false,
    visionDisabledByUser: !allowVision,
    tools,
    jsonMode: true,
    nativeSchema: provider === 'anthropic',
    structuredModes,
    local,
  };
}
