/**
 * Extracts the offending metric name from a Meta "invalid metric" error message.
 * When `candidates` (the metrics that were requested) are given, the first one mentioned wins.
 */
export function metricFromErrorMessage(message = '', candidates = []) {
  const text = String(message);
  for (const c of candidates) {
    if (new RegExp(`(^|[^a-z_])${c}([^a-z_]|$)`, 'i').test(text)) return c;
  }
  const patterns = [
    /\bmetrics?\s+"?([a-z_]+)"?\s+(?:is|are)\s+(?:not|no longer)\s+supported/i,
    /\b(?:the\s+)?([a-z_]+)\s+metric\s+(?:is|are)\s+(?:not|no longer)\s+supported/i,
    /not\s+supported[^"]*"([a-z_]+)"/i,
    /"([a-z_]+)"/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) return m[1];
  }
  return null;
}
