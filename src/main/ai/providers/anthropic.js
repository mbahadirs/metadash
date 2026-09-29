import Anthropic from '@anthropic-ai/sdk';
import { AiError } from '../errors.js';
import { ANTHROPIC_MODELS, DEFAULT_MODELS } from '../models.js';
import { closedSchema, strictJsonSchema, DEFAULT_TIMEOUT_MS } from './http.js';

export const ANTHROPIC_MAX_TOKENS = 16_000;
const THINKING_MODELS = new Set(['claude-opus-5', 'claude-sonnet-5']);
const FALLBACK_MODELS = new Set(['claude-opus-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const STOP = { end_turn: 'end', stop_sequence: 'end', tool_use: 'tool_use', max_tokens: 'max_tokens', model_context_window_exceeded: 'max_tokens', pause_turn: 'pause_turn', refusal: 'refusal' };

/** Every curated Claude model accepts base64 image blocks (VERIFY when the catalogue in models.js changes). */
export function supportsVision(model) {
  return ANTHROPIC_MODELS.includes(model);
}

/** User turn; images ({ mime, data } base64) go before the text block, as the API recommends. */
export function anthropicUserMessage(text, { images = [] } = {}) {
  if (!images.length) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } })),
      { type: 'text', text },
    ],
  };
}

/**
 * Pure request builder. opus-5/sonnet-5 get adaptive thinking + medium effort (never budget_tokens/temperature/top_p);
 * opus-5 additionally goes through the beta endpoint with server-side refusal fallbacks.
 * responseFormat { type: 'json_schema', schema } → output_config.format (structured outputs; the schema is made strict).
 */
export function buildAnthropicRequest({ model, system, messages, tools = [], maxTokens = ANTHROPIC_MAX_TOKENS, continuation = false, responseFormat }) {
  const id = ANTHROPIC_MODELS.includes(model) ? model : DEFAULT_MODELS.anthropic;
  if (!continuation && messages.at(-1)?.role === 'assistant') throw new AiError('ai_prefill');
  const beta = FALLBACK_MODELS.has(id);
  const thinking = THINKING_MODELS.has(id);
  const format = responseFormat?.type === 'json_schema' ? { format: { type: 'json_schema', schema: strictJsonSchema(responseFormat.schema) } } : {};
  const outputConfig = { ...(thinking ? { effort: 'medium' } : {}), ...format };
  const params = {
    model: id,
    max_tokens: maxTokens,
    system,
    messages,
    ...(tools.length ? { tools: tools.map(toAnthropicTool) } : {}),
    ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    ...(beta ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
  };
  return { beta, params };
}

function toAnthropicTool(t) {
  return { name: t.name, description: t.description, input_schema: closedSchema(t.parameters), strict: true };
}

/** Pure response normalizer: checks stop_reason, then collects text + tool_use blocks. raw keeps the FULL content. */
export function normalizeAnthropicResponse(resp) {
  const stopReason = STOP[resp?.stop_reason] ?? 'end';
  const content = Array.isArray(resp?.content) ? resp.content : [];
  const base = { stopReason, raw: resp?.content ?? [], usage: { inputTokens: resp?.usage?.input_tokens ?? 0, outputTokens: resp?.usage?.output_tokens ?? 0 } };
  if (stopReason === 'refusal') return { ...base, text: '', toolCalls: [], refusalCategory: resp?.stop_details?.category ?? null };
  const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
  const toolCalls = content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
  return { ...base, text, toolCalls };
}

/** Maps typed SDK errors to localized AiErrors; anything else is returned unchanged. */
export function mapAnthropicError(err, model) {
  const opts = { cause: err };
  if (err instanceof Anthropic.APIUserAbortError) return new AiError('ai_cancelled', opts);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError('ai_timeout', opts);
  if (err instanceof Anthropic.APIConnectionError) return new AiError('ai_network', opts);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiError('ai_auth', opts);
  if (err instanceof Anthropic.RateLimitError) return new AiError('ai_rate_limit', opts);
  if (err instanceof Anthropic.NotFoundError) return new AiError('ai_model_not_found', { ...opts, vars: { model: model ?? '' } });
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError) {
    // detail is kept off the user message but lets callers detect image/tool rejections (ai/errors.js isImageRejection).
    return Object.assign(new AiError('ai_bad_request', { ...opts, vars: { status: err.status, detail: '' } }), { status: err.status, detail: String(err.error?.error?.message ?? '').slice(0, 200) });
  }
  if (err instanceof Anthropic.APIError) {
    return (err.status ?? 0) >= 500 ? new AiError('ai_server', opts) : new AiError('ai_bad_request', { ...opts, vars: { status: err.status ?? '?', detail: '' } });
  }
  return err;
}

/** Anthropic provider built on the official SDK. `client` is injectable for tests. */
export function createAnthropicProvider({ apiKey, model, client }) {
  const sdk = client ?? new Anthropic({ apiKey, maxRetries: 2, timeout: DEFAULT_TIMEOUT_MS });
  const id = ANTHROPIC_MODELS.includes(model) ? model : DEFAULT_MODELS.anthropic;
  return {
    id: 'anthropic',
    model: id,
    vision: supportsVision(id),
    structuredModes: ['schema'], // native output_config.format; never parse tool inputs as strings
    userMessage: anthropicUserMessage,
    assistantMessage: (text) => ({ role: 'assistant', content: text }),
    appendAssistant: (messages, res) => [...messages, { role: 'assistant', content: res.raw }],
    appendToolResults: (messages, res, results) => [
      ...messages,
      { role: 'assistant', content: res.raw },
      { role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })) },
    ],
    async complete({ system, messages, tools, maxTokens, signal, continuation, responseFormat }) {
      const { beta, params } = buildAnthropicRequest({ model: id, system, messages, tools, maxTokens: maxTokens ?? ANTHROPIC_MAX_TOKENS, continuation, responseFormat });
      try {
        const resp = beta ? await sdk.beta.messages.create(params, { signal }) : await sdk.messages.create(params, { signal });
        return normalizeAnthropicResponse(resp);
      } catch (err) {
        throw mapAnthropicError(err, id);
      }
    },
  };
}
