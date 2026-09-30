/**
 * Offline question rule (no network, always on): a question mark, a sentence opening with a question word
 * (en/de/es), or a Turkish question particle/word anywhere. Used for inbox_state.is_question.
 */
/** Words that make a sentence a question when they open it. */
const LEADING = [
  'what', 'how', 'when', 'where', 'why', 'who', 'which', 'can', 'could', 'do', 'does', 'did', 'is', 'are', 'will', 'would', 'any',
  'wie', 'wann', 'wo', 'warum', 'wer', 'welche', 'gibt es', 'kann', 'haben',
  'qué', 'cómo', 'cuándo', 'dónde', 'por qué', 'quién', 'cuál', 'cuánto', 'hay',
];
/** Turkish question particles and words that mark a question anywhere in the sentence. */
const ANYWHERE = [
  'mı', 'mi', 'mu', 'mü', 'mısın', 'misin', 'musun', 'müsün', 'mısınız', 'misiniz', 'musunuz', 'müsünüz', 'mıdır', 'midir', 'mudur', 'müdür',
  'nasıl', 'neden', 'niye', 'nerede', 'nereden', 'kaç', 'hangi', 'ne zaman', 'ne kadar',
];
const alt = (words) => words.map((w) => w.replace(/ /g, '\\s+')).join('|');
const LEADING_RE = new RegExp(`(^|[.!]\\s*)(${alt(LEADING)})(?=$|[\\s,])`, 'u');
const ANYWHERE_RE = new RegExp(`(^|[\\s,.!])(${alt(ANYWHERE)})(?=$|[\\s,.!])`, 'u');

export function isQuestion(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (/[?？؟¿]/.test(s)) return true;
  const lower = s.toLowerCase().slice(0, 300);
  return LEADING_RE.test(lower) || ANYWHERE_RE.test(lower);
}
