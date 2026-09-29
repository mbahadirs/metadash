import { AiError, isImageRejection, isToolRejection } from './errors.js';
import { strictJsonSchema } from './providers/http.js';

export { strictJsonSchema };

/** Name of the single tool used to capture structured results in tool mode. */
export const STRUCTURED_TOOL = 'emit_result';

const MAX_ERRORS_SHOWN = 12;

/**
 * Structured (JSON) generation on top of any provider:
 * - 'schema' (Anthropic): output_config.format json_schema; the text answer is guaranteed JSON → JSON.parse.
 * - 'tool': one forced `emit_result` tool whose input object IS the result (never string-matched).
 * - 'json': provider JSON mode + schema in the system prompt; the text is parsed (fences / first {…} block tolerated).
 * Modes are tried in order; a mode is skipped when the provider rejects tools or the model ignores the tool.
 * The result is always validated locally against the full schema; one repair turn is allowed, then ai_schema_invalid.
 * If images are rejected by a model of unknown vision support, the call is retried once without them.
 * Returns { data, usage, mode, repaired, visionDropped, calls }.
 */
export async function runStructured({ provider, system, userText, images = [], schema, name = STRUCTURED_TOOL, description, signal, maxTokens, modes }) {
  const order = modes ?? provider.structuredModes ?? ['tool', 'json'];
  const state = { usage: { inputTokens: 0, outputTokens: 0 }, calls: 0, visionDropped: false, images };
  let lastErr = null;
  for (const mode of order) {
    try {
      const out = await runMode(mode, { provider, system, userText, schema, name, description, signal, maxTokens, state });
      if (out) return { ...out, mode, usage: state.usage, visionDropped: state.visionDropped, calls: state.calls };
    } catch (err) {
      if (mode === 'tool' && isToolRejection(err) && order.at(-1) !== 'tool') { lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr ?? new AiError('ai_schema_invalid', { vars: { detail: 'no structured answer' } });
}

/** One mode: first call (+ image-drop retry), capture, validate, at most one repair turn. null → try the next mode. */
async function runMode(mode, ctx) {
  const { provider, schema } = ctx;
  const request = requestFor(mode, ctx);
  let messages = [provider.userMessage(ctx.userText, { images: ctx.state.images })];
  let res = await call(ctx, request, messages, true);
  let data = capture(mode, res, ctx.name);
  if (data === undefined) {
    if (mode === 'tool') return null; // model answered in prose: fall through to JSON mode
    throw new AiError('ai_schema_invalid', { vars: { detail: 'not JSON' } });
  }
  let errors = validateSchema(data, schema);
  if (!errors.length) return { data, repaired: false };
  messages = repairMessages(mode, provider, messages, res, ctx.name, errors);
  res = await call(ctx, request, messages, false);
  data = capture(mode, res, ctx.name);
  errors = data === undefined ? ['$: no JSON object'] : validateSchema(data, schema);
  if (errors.length) throw new AiError('ai_schema_invalid', { vars: { detail: errors.slice(0, 3).join('; ') } });
  return { data, repaired: true };
}

function requestFor(mode, { system, schema, name, description }) {
  if (mode === 'schema') return { system, responseFormat: { type: 'json_schema', name, schema } };
  if (mode === 'tool') {
    const tool = { name, description: description ?? 'Return the final result. Call this exactly once with the complete result.', parameters: schema };
    return { system: `${system}\n\nWhen you are done, call the ${name} tool exactly once with the complete result. Do not answer in prose.`, tools: [tool], toolChoice: name };
  }
  return { system: `${system}\n\n${jsonInstruction(schema)}`, responseFormat: { type: 'json' } };
}

export function jsonInstruction(schema) {
  return `Respond with only one JSON object (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(schema)}`;
}

async function call(ctx, request, messages, allowImageRetry) {
  const { provider, signal, maxTokens, state } = ctx;
  let res;
  try {
    res = await provider.complete({ ...request, messages, maxTokens, signal });
  } catch (err) {
    if (!(allowImageRetry && state.images.length && isImageRejection(err))) throw err;
    state.images = [];
    state.visionDropped = true;
    const textOnly = [provider.userMessage(ctx.userText, { images: [] })];
    messages.splice(0, messages.length, ...textOnly);
    res = await provider.complete({ ...request, messages, maxTokens, signal });
  }
  state.calls += 1;
  state.usage = { inputTokens: state.usage.inputTokens + (res.usage?.inputTokens ?? 0), outputTokens: state.usage.outputTokens + (res.usage?.outputTokens ?? 0) };
  if (res.stopReason === 'refusal') throw new AiError('ai_refusal', { category: res.refusalCategory });
  if (res.stopReason === 'max_tokens' && !res.toolCalls?.length) throw new AiError('ai_truncated');
  return res;
}

/** Extracts the candidate result: tool input object (tool mode) or parsed text (schema/json, and prose-JSON in tool mode). */
function capture(mode, res, name) {
  if (mode === 'tool') {
    const hit = (res.toolCalls ?? []).find((c) => c.name === name);
    if (hit) return hit.input && typeof hit.input === 'object' ? hit.input : undefined;
  }
  return parseJsonText(res.text);
}

function repairMessages(mode, provider, messages, res, name, errors) {
  const note = `The result did not match the required schema:\n${errors.slice(0, MAX_ERRORS_SHOWN).join('\n')}\nFix these problems and return the complete corrected result.`;
  const hit = mode === 'tool' ? (res.toolCalls ?? []).find((c) => c.name === name) : null;
  if (hit) return provider.appendToolResults(messages, res, [{ id: hit.id, name, content: note, isError: true }]);
  return [...provider.appendAssistant(messages, res), provider.userMessage(note)];
}

/**
 * Parses a JSON object from model text: whole text, a ```json fenced block, or the first balanced {…} block.
 * Returns undefined when there is no JSON object (arrays and scalars are rejected).
 */
export function parseJsonText(text) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const candidates = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) candidates.push(fence[1].trim());
  const block = firstObjectBlock(text);
  if (block) candidates.push(block);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      // next candidate
    }
  }
  return undefined;
}

function firstObjectBlock(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const matchesType = (v, t) => {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
};

/**
 * Small JSON-schema validator for model output: type (incl. unions), properties, required, additionalProperties:false,
 * items, enum, const, anyOf, min/maxLength, minimum/maximum, min/maxItems. Returns error strings with $.paths.
 */
export function validateSchema(value, schema, at = '$') {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => validateSchema(value, s, at).length === 0);
    return ok ? [] : [`${at}: does not match any allowed shape`];
  }
  const errors = [];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) return [`${at}: expected ${types.join('|')}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) errors.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  if ('const' in schema && schema.const !== value) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (typeof value === 'string') {
    const len = [...value].length;
    if (schema.minLength != null && len < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength} characters`);
    if (schema.maxLength != null && len > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength} characters (${len})`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${at}: at most ${schema.maxItems} items (${value.length})`);
    if (schema.items) value.forEach((v, i) => errors.push(...validateSchema(v, schema.items, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties ?? {};
    for (const req of schema.required ?? []) if (!(req in value)) errors.push(`${at}.${req}: required`);
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errors.push(...validateSchema(v, props[k], `${at}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${at}.${k}: not allowed`);
    }
  }
  return errors;
}
