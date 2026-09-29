import { AiError } from './errors.js';

/**
 * Provider-agnostic agent loop. The provider supplies native message shapes:
 *   userMessage(text), complete({ system, messages, tools, maxTokens, signal, continuation }),
 *   appendAssistant(messages, res), appendToolResults(messages, res, results) — both return new arrays.
 * Tools use the neutral shape { name, description, parameters: JSONSchema }.
 */
export async function runToolLoop({ provider, system, userText, tools = [], execute, maxSteps = 8, maxTokens, signal }) {
  let messages = [provider.userMessage(userText)];
  let continuation = false;
  let usage = { inputTokens: 0, outputTokens: 0 };
  for (let step = 1; step <= maxSteps; step += 1) {
    const res = await provider.complete({ system, messages, tools, maxTokens, signal, continuation });
    usage = addUsage(usage, res.usage);
    if (res.stopReason === 'refusal') throw new AiError('ai_refusal', { category: res.refusalCategory });
    if (res.stopReason === 'pause_turn') {
      messages = provider.appendAssistant(messages, res);
      continuation = true;
      continue;
    }
    continuation = false;
    if (res.toolCalls?.length) {
      const results = await runTools(res.toolCalls, execute);
      messages = provider.appendToolResults(messages, res, results);
      continue;
    }
    const text = (res.text ?? '').trim();
    if (!text) throw new AiError(res.stopReason === 'max_tokens' ? 'ai_truncated' : 'ai_empty');
    return { text, stopReason: res.stopReason, truncated: res.stopReason === 'max_tokens', steps: step, usage };
  }
  throw new AiError('ai_max_steps', { vars: { n: maxSteps } });
}

function addUsage(a, b) {
  return { inputTokens: a.inputTokens + (b?.inputTokens ?? 0), outputTokens: a.outputTokens + (b?.outputTokens ?? 0) };
}

/** Executes every tool call; failures become { isError: true } results so the model can recover. */
function runTools(calls, execute) {
  return Promise.all(calls.map(async ({ id, name, input }) => {
    try {
      if (typeof execute !== 'function') throw new Error(`No executor for tool "${name}"`);
      const out = await execute(name, input);
      return { id, name, content: typeof out === 'string' ? out : JSON.stringify(out ?? null) };
    } catch (err) {
      return { id, name, content: String(err?.message ?? err), isError: true };
    }
  }));
}
