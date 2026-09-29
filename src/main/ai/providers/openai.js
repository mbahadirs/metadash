import { postJson, safeJsonParse } from './http.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MAX_TOKENS = 8_000;
const STOP = { stop: 'end', tool_calls: 'tool_use', function_call: 'tool_use', length: 'max_tokens', content_filter: 'refusal' };

/**
 * Vision by model name. Model names are free text, so this is an allowlist (VERIFY against the OpenAI model docs):
 * true for gpt-4o / gpt-4.1 / gpt-4-turbo / gpt-5 / o1 / o3 / o4 families, false for known text-only minis, else 'unknown'
 * (the caller tries with images and retries text-only when the API rejects them).
 */
export function supportsVision(model) {
  const m = String(model ?? '').toLowerCase();
  if (/^(o1-mini|o3-mini|gpt-3\.5|gpt-4-0|gpt-4$)/.test(m)) return false;
  if (/^(gpt-4o|chatgpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o1|o3|o4)/.test(m)) return true;
  return 'unknown';
}

/** User turn; images become data-URL image_url parts after the text part. detail: 'low' | 'high' | 'auto'. */
export function openaiUserMessage(text, { images = [], detail = 'auto' } = {}) {
  if (!images.length) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}`, detail: img.detail ?? detail } })),
    ],
  };
}

/** response_format for JSON mode: { type:'json' } → json_object; { type:'json_schema' } → non-strict json_schema (VERIFY). */
function responseFormatFor(rf) {
  if (rf?.type === 'json') return { type: 'json_object' };
  if (rf?.type === 'json_schema') return { type: 'json_schema', json_schema: { name: rf.name ?? 'result', schema: rf.schema, strict: false } };
  return null;
}

/** Pure Chat Completions request (system prompt prepended; messages stay native). toolChoice forces one function. */
export function buildOpenAIRequest({ model, system, messages, tools = [], maxTokens = OPENAI_MAX_TOKENS, toolChoice, responseFormat }) {
  const format = responseFormatFor(responseFormat);
  return {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
    ...(tools.length && toolChoice ? { tool_choice: { type: 'function', function: { name: toolChoice } } } : {}),
    ...(format ? { response_format: format } : {}),
    max_completion_tokens: maxTokens,
  };
}

/** Pure normalizer for a Chat Completions response. */
export function normalizeOpenAIResponse(resp) {
  const choice = resp?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function?.name, input: safeJsonParse(c.function?.arguments) }));
  const stopReason = message.refusal ? 'refusal' : STOP[choice.finish_reason] ?? (toolCalls.length ? 'tool_use' : 'end');
  return {
    text: typeof message.content === 'string' ? message.content : '',
    toolCalls,
    stopReason,
    raw: message,
    usage: { inputTokens: resp?.usage?.prompt_tokens ?? 0, outputTokens: resp?.usage?.completion_tokens ?? 0 },
  };
}

export function createOpenAIProvider({ apiKey, model, fetchImpl, baseUrl = ENDPOINT }) {
  return {
    id: 'openai',
    model,
    vision: supportsVision(model),
    structuredModes: ['tool', 'json'],
    userMessage: openaiUserMessage,
    assistantMessage: (text) => ({ role: 'assistant', content: text }),
    appendAssistant: (messages, res) => [...messages, res.raw],
    appendToolResults: (messages, res, results) => [...messages, res.raw, ...results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.content }))],
    async complete({ system, messages, tools, maxTokens, signal, toolChoice, responseFormat }) {
      const body = buildOpenAIRequest({ model, system, messages, tools, maxTokens, toolChoice, responseFormat });
      const resp = await postJson(baseUrl, body, { headers: { Authorization: `Bearer ${apiKey}` }, signal, fetchImpl, model });
      return normalizeOpenAIResponse(resp);
    },
  };
}
