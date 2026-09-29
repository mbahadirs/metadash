import { postJson, safeJsonParse } from './http.js';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MAX_TOKENS = 8_000;
const STOP = { stop: 'end', tool_calls: 'tool_use', function_call: 'tool_use', length: 'max_tokens', content_filter: 'refusal' };

/** Pure Chat Completions request (system prompt prepended; messages stay native). */
export function buildOpenAIRequest({ model, system, messages, tools = [], maxTokens = OPENAI_MAX_TOKENS }) {
  return {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
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
    userMessage: (text) => ({ role: 'user', content: text }),
    assistantMessage: (text) => ({ role: 'assistant', content: text }),
    appendAssistant: (messages, res) => [...messages, res.raw],
    appendToolResults: (messages, res, results) => [...messages, res.raw, ...results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.content }))],
    async complete({ system, messages, tools, maxTokens, signal }) {
      const body = buildOpenAIRequest({ model, system, messages, tools, maxTokens });
      const resp = await postJson(baseUrl, body, { headers: { Authorization: `Bearer ${apiKey}` }, signal, fetchImpl, model });
      return normalizeOpenAIResponse(resp);
    },
  };
}
