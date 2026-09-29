import { postJson, closedSchema, safeJsonParse } from './http.js';
import { DEFAULT_OLLAMA_URL } from '../models.js';

export const OLLAMA_MAX_TOKENS = 4_096;
const OLLAMA_TIMEOUT_MS = 300_000; // local models can be slow on first load

/** Pure /api/chat request (non-streaming). */
export function buildOllamaRequest({ model, system, messages, tools = [], maxTokens = OLLAMA_MAX_TOKENS }) {
  return {
    model,
    stream: false,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: closedSchema(t.parameters) } })) } : {}),
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
    userMessage: (text) => ({ role: 'user', content: text }),
    appendAssistant: (messages, res) => [...messages, res.raw],
    appendToolResults: (messages, res, results) => [...messages, res.raw, ...results.map((r) => ({ role: 'tool', content: r.content, tool_name: r.name }))],
    async complete({ system, messages, tools, maxTokens, signal }) {
      const resp = await postJson(`${baseUrl}/api/chat`, buildOllamaRequest({ model, system, messages, tools, maxTokens }), { signal, fetchImpl, model, timeoutMs: OLLAMA_TIMEOUT_MS });
      return normalizeOllamaResponse(resp);
    },
  };
}
