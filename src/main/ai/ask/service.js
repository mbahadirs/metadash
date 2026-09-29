import { currentLang } from '../../i18n.js';
import { AiError } from '../errors.js';
import { assertAiEnabled, readApiKey } from '../settings.js';
import { createProvider } from '../providers/index.js';
import { runToolLoop } from '../toolLoop.js';
import { askSystemPrompt } from '../prompts.js';
import { buildSchemaDescription } from './schema.js';
import { ASK_TOOLS, createAskExecutor } from './tools.js';

const REQUEST_TIMEOUT_MS = 300_000;
const MAX_STEPS = 8;
const HISTORY_TURNS = 6;
const QUESTION_MAX = 2000;
const ANSWER_MAX = 4000;
const REQUEST_ID_MAX = 100;

/** In-flight requests by renderer-supplied id, so ai:askCancel can abort them. */
const inflight = new Map();

const pickLang = (lang) => (lang === 'tr' || lang === 'en' ? lang : currentLang());

/** Prior turns as plain text only (no tool traces): valid { question, answer } strings, trimmed, last HISTORY_TURNS. */
export function historyTurns(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((h) => typeof h?.question === 'string' && typeof h?.answer === 'string' && h.question.trim() && h.answer.trim())
    .slice(-HISTORY_TURNS)
    .map((h) => ({ question: h.question.trim().slice(0, QUESTION_MAX), answer: h.answer.trim().slice(0, ANSWER_MAX) }));
}

function assertQuestion(question) {
  const q = typeof question === 'string' ? question.trim() : '';
  if (!q || q.length > QUESTION_MAX) throw new AiError('ai_bad_input', { vars: { field: 'question' } });
  return q;
}

/** Aborts an in-flight ask request. Returns false when nothing with that id is running. */
export function cancelAsk(requestId) {
  const controller = inflight.get(requestId);
  if (!controller) return false;
  controller.abort();
  inflight.delete(requestId);
  return true;
}

function register(requestId) {
  const id = typeof requestId === 'string' && requestId && requestId.length <= REQUEST_ID_MAX ? requestId : null;
  const controller = new AbortController();
  if (id) {
    inflight.get(id)?.abort();
    inflight.set(id, controller);
  }
  const release = () => { if (id && inflight.get(id) === controller) inflight.delete(id); };
  return { controller, release };
}

/**
 * Answers a natural-language question by letting the model query the local DB (read-only, guarded).
 * Returns { answer (markdown), steps, truncated, refusal, provider, model }. `deps.provider` is injectable for tests.
 */
export async function askData({ requestId, question, history, period, lang } = {}, deps = {}) {
  const cfg = assertAiEnabled();
  const q = assertQuestion(question);
  const provider = deps.provider ?? createProvider(cfg, cfg.provider === 'ollama' ? null : readApiKey(cfg.provider));
  const language = pickLang(lang);
  const executor = createAskExecutor({ period });
  const { controller, release } = register(requestId);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  const meta = { provider: provider.id, model: provider.model };
  try {
    const res = await runToolLoop({
      provider,
      system: askSystemPrompt(language, buildSchemaDescription()),
      userText: q,
      history: historyTurns(history),
      tools: ASK_TOOLS,
      execute: (name, input) => {
        if (signal.aborted) throw new AiError('ai_cancelled');
        return executor.execute(name, input);
      },
      maxSteps: MAX_STEPS,
      signal,
    });
    return { answer: res.text, steps: executor.steps(), truncated: res.truncated, refusal: false, ...meta };
  } catch (err) {
    if (controller.signal.aborted) throw new AiError('ai_cancelled', { cause: err });
    if (err instanceof AiError && err.key === 'ai_refusal') return { answer: err.message, steps: executor.steps(), truncated: false, refusal: true, ...meta };
    throw err;
  } finally {
    release();
  }
}
