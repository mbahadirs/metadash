import { postJson, closedSchema, safeJsonParse } from './http.js';
import { DEFAULT_OLLAMA_URL } from '../models.js';

export const OLLAMA_MAX_TOKENS = 4_096;
const OLLAMA_TIMEOUT_MS = 300_000; // local models can be slow on first load

/** Name-based guess for well-known local vision families; the /api/show probe (ai/capabilities.js) is authoritative. */
const VISION_FAMILIES = /^(llava|bakllava|llama3\.2-vision|llama4|qwen2\.5vl|qwen2-vl|qwen2\.5-vl|qwen3-vl|gemma3|minicpm-v|moondream|granite3\.2-vision|mistral-small3\.[12])/;
export function supportsVision(model) {
  return VISION_FAMILIES.test(String(model ?? '').toLowerCase()) ? true : 'unknown';
}

/** User turn; Ollama takes raw base64 strings in `images` next to the text content. */
export function ollamaUserMessage(text, { images = [] } = {}) {
  return images.length ? { role: 'user', content: text, images: images.map((img) => img.data) } : { role: 'user', content: text };
}

/**
 * Pure /api/chat request (non-streaming). responseFormat json → format:'json'; json_schema → format:<schema>
 * (structured outputs, Ollama ≥ 0.5 — VERIFY on older servers). Ollama has no forced tool choice.
 */
export function buildOllamaRequest({ model, system, messages, tools = [], maxTokens = OLLAMA_MAX_TOKENS, responseFormat }) {
  const format = responseFormat?.type === 'json' ? 'json' : responseFormat?.type === 'json_schema' ? closedSchema(responseFormat.schema) : null;
  return {
    model,
    stream: false,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: closedSchema(t.parameters) } })) } : {}),
    ...(format ? { format } : {}),
    options: { num_predict: maxTokens },
  };
}

/** Pure normalizer; Ollama tool calls carry object arguments and no ids. */
export function normalizeOllamaResponse(resp) {
  const message = resp?.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.function?.name, input: safeJsonParse(c.function?.arguments) }));
  const stopReason = toolCalls.length ? 'tool_use' : resp?.done_reason === 'length' ? 'max_tokens' : 'end';
  return {
    text: typeof message.content === 'string' ? message.content : '',
    toolCalls,
    stopReason,
    raw: message,
    usage: { inputTokens: resp?.prompt_eval_count ?? 0, outputTokens: resp?.eval_count ?? 0 },
  };
}

export function createOllamaProvider({ baseUrl = DEFAULT_OLLAMA_URL, model, fetchImpl }) {
  return {
    id: 'ollama',
    model,
    vision: supportsVision(model),
    structuredModes: ['tool', 'json'], // ai/capabilities.js narrows this to ['json'] when /api/show lacks 'tools'
    local: true,
    userMessage: ollamaUserMessage,
    assistantMessage: (text) => ({ role: 'assistant', content: text }),
    appendAssistant: (messages, res) => [...messages, res.raw],
    appendToolResults: (messages, res, results) => [...messages, res.raw, ...results.map((r) => ({ role: 'tool', content: r.content, tool_name: r.name }))],
    async complete({ system, messages, tools, maxTokens, signal, responseFormat }) {
      const resp = await postJson(`${baseUrl}/api/chat`, buildOllamaRequest({ model, system, messages, tools, maxTokens, responseFormat }), { signal, fetchImpl, model, timeoutMs: OLLAMA_TIMEOUT_MS });
      return normalizeOllamaResponse(resp);
    },
  };
}
