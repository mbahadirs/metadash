import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { buildAnthropicRequest, normalizeAnthropicResponse, mapAnthropicError, createAnthropicProvider } from '../src/main/ai/providers/anthropic.js';

const TOOL = { name: 'get_posts', description: 'List posts', parameters: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'] } };
const USER = [{ role: 'user', content: 'hi' }];

describe('buildAnthropicRequest', () => {
  it('claude-opus-5: adaptive thinking, medium effort, server-side fallbacks via beta', () => {
    const { beta, params } = buildAnthropicRequest({ model: 'claude-opus-5', system: 'sys', messages: USER });
    expect(beta).toBe(true);
    expect(params).toMatchObject({ model: 'claude-opus-5', system: 'sys', messages: USER, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(JSON.stringify(params)).not.toContain('budget_tokens');
    expect(params).not.toHaveProperty('tools');
  });

  it('claude-sonnet-5: adaptive thinking + effort, standard endpoint, no betas', () => {
    const { beta, params } = buildAnthropicRequest({ model: 'claude-sonnet-5', system: 's', messages: USER });
    expect(beta).toBe(false);
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params).not.toHaveProperty('betas');
    expect(params).not.toHaveProperty('fallbacks');
  });

  it('claude-haiku-4-5: no thinking, no effort', () => {
    const { beta, params } = buildAnthropicRequest({ model: 'claude-haiku-4-5', system: 's', messages: USER, maxTokens: 500 });
    expect(beta).toBe(false);
    expect(params.max_tokens).toBe(500);
    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('output_config');
  });

  it('converts tools to strict input_schema with additionalProperties:false', () => {
    const { params } = buildAnthropicRequest({ model: 'claude-haiku-4-5', system: 's', messages: USER, tools: [TOOL] });
    expect(params.tools).toEqual([{ name: 'get_posts', description: 'List posts', input_schema: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'], additionalProperties: false }, strict: true }]);
  });

  it('rejects an assistant prefill unless continuing a paused turn', () => {
    const msgs = [...USER, { role: 'assistant', content: [{ type: 'text', text: 'Sure' }] }];
    expect(() => buildAnthropicRequest({ model: 'claude-sonnet-5', system: 's', messages: msgs })).toThrow();
    expect(() => buildAnthropicRequest({ model: 'claude-sonnet-5', system: 's', messages: msgs, continuation: true })).not.toThrow();
  });

  it('falls back to the default model for unknown ids', () => {
    expect(buildAnthropicRequest({ model: 'gpt-4', system: 's', messages: USER }).params.model).toBe('claude-opus-5');
  });
});

describe('normalizeAnthropicResponse', () => {
  it('collects text and tool_use blocks, keeps full content (incl. thinking) as raw', () => {
    const resp = {
      stop_reason: 'tool_use', stop_details: null, usage: { input_tokens: 12, output_tokens: 34 },
      content: [
        { type: 'thinking', thinking: '…', signature: 'sig' },
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_posts', input: { day: '2026-09-01' } },
      ],
    };
    const n = normalizeAnthropicResponse(resp);
    expect(n.stopReason).toBe('tool_use');
    expect(n.text).toBe('Let me check.');
    expect(n.toolCalls).toEqual([{ id: 'toolu_1', name: 'get_posts', input: { day: '2026-09-01' } }]);
    expect(n.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
    expect(n.raw).toBe(resp.content);
  });

  it('maps stop reasons and refusal category', () => {
    expect(normalizeAnthropicResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }).text).toBe('a\n\nb');
    expect(normalizeAnthropicResponse({ stop_reason: 'max_tokens', content: [] }).stopReason).toBe('max_tokens');
    expect(normalizeAnthropicResponse({ stop_reason: 'pause_turn', content: [] }).stopReason).toBe('pause_turn');
    const r = normalizeAnthropicResponse({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] });
    expect(r).toMatchObject({ stopReason: 'refusal', refusalCategory: 'cyber', toolCalls: [] });
  });
});

describe('anthropic provider', () => {
  const fakeClient = (resp) => {
    const log = [];
    const create = (route) => async (params) => { log.push([route, params]); return resp; };
    return { log, messages: { create: create('messages') }, beta: { messages: { create: create('beta') } } };
  };

  it('routes opus-5 through client.beta.messages.create and others through client.messages.create', async () => {
    const resp = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } };
    const c1 = fakeClient(resp);
    await createAnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', client: c1 }).complete({ system: 's', messages: USER });
    expect(c1.log[0][0]).toBe('beta');
    const c2 = fakeClient(resp);
    await createAnthropicProvider({ apiKey: 'k', model: 'claude-haiku-4-5', client: c2 }).complete({ system: 's', messages: USER });
    expect(c2.log[0][0]).toBe('messages');
  });

  it('appends the full assistant content and one user turn with all tool_result blocks', () => {
    const p = createAnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5', client: fakeClient({}) });
    const raw = [{ type: 'thinking', thinking: 't', signature: 's' }, { type: 'tool_use', id: 'a', name: 'x', input: {} }, { type: 'tool_use', id: 'b', name: 'y', input: {} }];
    const next = p.appendToolResults(USER, { raw }, [{ id: 'a', name: 'x', content: '1' }, { id: 'b', name: 'y', content: 'bad', isError: true }]);
    expect(next).toHaveLength(3);
    expect(USER).toHaveLength(1); // not mutated
    expect(next[1]).toEqual({ role: 'assistant', content: raw });
    expect(next[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '1' }, { type: 'tool_result', tool_use_id: 'b', content: 'bad', is_error: true }] });
  });
});

describe('mapAnthropicError', () => {
  const headers = new Headers();
  it('maps typed SDK errors to localized AiErrors', () => {
    expect(mapAnthropicError(new Anthropic.AuthenticationError(401, {}, 'bad key', headers)).key).toBe('ai_auth');
    expect(mapAnthropicError(new Anthropic.RateLimitError(429, {}, 'slow', headers)).key).toBe('ai_rate_limit');
    expect(mapAnthropicError(new Anthropic.BadRequestError(400, {}, 'bad', headers)).key).toBe('ai_bad_request');
    expect(mapAnthropicError(new Anthropic.NotFoundError(404, {}, 'nf', headers)).key).toBe('ai_model_not_found');
    expect(mapAnthropicError(new Anthropic.InternalServerError(529, {}, 'overloaded', headers)).key).toBe('ai_server');
    expect(mapAnthropicError(new Anthropic.APIConnectionError({ message: 'down' })).key).toBe('ai_network');
    expect(mapAnthropicError(new Anthropic.APIConnectionTimeoutError()).key).toBe('ai_timeout');
    expect(mapAnthropicError(new Anthropic.APIUserAbortError()).key).toBe('ai_cancelled');
  });
  it('passes unrelated errors through unchanged', () => {
    const e = new TypeError('x');
    expect(mapAnthropicError(e)).toBe(e);
  });
});
