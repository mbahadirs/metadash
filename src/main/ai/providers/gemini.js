import { postJson } from './http.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_MAX_TOKENS = 8_192;
const REFUSAL = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

/** Gemini's schema subset does not accept additionalProperties; strip it recursively. */
function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => k !== 'additionalProperties').map(([k, v]) => [k, geminiSchema(v)]));
}

/** Gemini rejects OBJECT schemas with no properties, so parameterless tools omit `parameters`. */
function geminiTool(t) {
  const hasProps = Object.keys(t.parameters?.properties ?? {}).length > 0;
  return { name: t.name, description: t.description, ...(hasProps ? { parameters: geminiSchema(t.parameters) } : {}) };
}

/** Pure generateContent body. */
export function buildGeminiRequest({ system, messages, tools = [], maxTokens = GEMINI_MAX_TOKENS }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages,
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map(geminiTool) }] } : {}),
    generationConfig: { maxOutputTokens: maxTokens },
  };
}

/** Pure normalizer: thought parts are excluded from text; function calls get stable ids when Gemini omits them. */
export function normalizeGeminiResponse(resp) {
  const usage = { inputTokens: resp?.usageMetadata?.promptTokenCount ?? 0, outputTokens: resp?.usageMetadata?.candidatesTokenCount ?? 0 };
  const cand = resp?.candidates?.[0];
  if (!cand) return { text: '', toolCalls: [], stopReason: resp?.promptFeedback?.blockReason ? 'refusal' : 'end', raw: null, usage };
  const parts = cand.content?.parts ?? [];
  const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  const toolCalls = parts.filter((p) => p.functionCall).map((p, i) => ({ id: p.functionCall.id ?? `call_${i}`, name: p.functionCall.name, input: p.functionCall.args ?? {} }));
  const stopReason = REFUSAL.has(cand.finishReason) ? 'refusal' : toolCalls.length ? 'tool_use' : cand.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end';
  return { text, toolCalls, stopReason, raw: cand.content ?? null, usage };
}

export function createGeminiProvider({ apiKey, model, fetchImpl, baseUrl = BASE }) {
  const url = `${baseUrl}/${encodeURIComponent(String(model).replace(/^models\//, ''))}:generateContent`;
  return {
    id: 'gemini',
    model,
    userMessage: (text) => ({ role: 'user', parts: [{ text }] }),
    assistantMessage: (text) => ({ role: 'model', parts: [{ text }] }),
    appendAssistant: (messages, res) => [...messages, res.raw],
    appendToolResults: (messages, res, results) => [
      ...messages,
      res.raw,
      { role: 'user', parts: results.map((r) => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.content } : { content: r.content } } })) },
    ],
    async complete({ system, messages, tools, maxTokens, signal }) {
      const resp = await postJson(url, buildGeminiRequest({ system, messages, tools, maxTokens }), { headers: { 'x-goog-api-key': apiKey }, signal, fetchImpl, model });
      return normalizeGeminiResponse(resp);
    },
  };
}
