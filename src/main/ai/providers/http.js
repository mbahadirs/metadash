import { httpError, fetchFailure } from '../errors.js';

export const DEFAULT_TIMEOUT_MS = 120_000;

/** POSTs JSON and returns the parsed body; maps HTTP/network failures to localized AiErrors. */
export async function postJson(url, body, { headers = {}, signal, fetchImpl = fetch, model, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    throw fetchFailure(err);
  }
  if (!res.ok) throw httpError(res.status, await errorDetail(res), { model });
  try {
    return await res.json();
  } catch (err) {
    throw fetchFailure(err);
  }
}

/** Best-effort short error text from a provider error body ({ error: { message } } or { error: "..." }). */
async function errorDetail(res) {
  try {
    const body = await res.json();
    const e = body?.error;
    return typeof e === 'string' ? e : e?.message ?? '';
  } catch {
    return '';
  }
}

/** Neutral tool → JSON schema with additionalProperties:false (used by OpenAI/Ollama/Anthropic). */
export function closedSchema(parameters) {
  return { type: 'object', properties: {}, ...parameters, additionalProperties: false };
}

export function safeJsonParse(text) {
  if (text && typeof text === 'object') return text;
  try {
    const v = JSON.parse(text || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
