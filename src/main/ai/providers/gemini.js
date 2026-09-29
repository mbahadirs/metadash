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

/** Gemini 1.5+ / 2.x / 3.x models are multimodal (VERIFY for new families); anything else is 'unknown'. */
export function supportsVision(model) {
  const m = String(model ?? '').toLowerCase().replace(/^models\//, '');
  if (/^gemini-(1\.5|[2-9])/.test(m)) return true;
  return 'unknown';
}

/** User turn; images become inline_data parts before the text part. */
export function geminiUserMessage(text, { images = [] } = {}) {
  return { role: 'user', parts: [...images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.data } })), { text }] };
}

/**
 * Pure generateContent body. toolChoice forces one function (functionCallingConfig ANY + allowedFunctionNames).
 * responseFormat json / json_schema → responseMimeType application/json (the schema itself goes in the prompt; VERIFY
 * responseJsonSchema support before sending schemas natively).
 */
export function buildGeminiRequest({ system, messages, tools = [], maxTokens = GEMINI_MAX_TOKENS, toolChoice, responseFormat }) {
  const json = responseFormat?.type === 'json' || responseFormat?.type === 'json_schema';
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages,
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map(geminiTool) }] } : {}),
    ...(tools.length && toolChoice ? { toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolChoice] } } } : {}),
    generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
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
    vision: supportsVision(model),
    structuredModes: ['tool', 'json'],
    userMessage: geminiUserMessage,
    assistantMessage: (text) => ({ role: 'model', parts: [{ text }] }),
    appendAssistant: (messages, res) => [...messages, res.raw],
    appendToolResults: (messages, res, results) => [
      ...messages,
      res.raw,
      { role: 'user', parts: results.map((r) => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.content } : { content: r.content } } })) },
    ],
    async complete({ system, messages, tools, maxTokens, signal, toolChoice, responseFormat }) {
      const resp = await postJson(url, buildGeminiRequest({ system, messages, tools, maxTokens, toolChoice, responseFormat }), { headers: { 'x-goog-api-key': apiKey }, signal, fetchImpl, model });
      return normalizeGeminiResponse(resp);
    },
  };
}
