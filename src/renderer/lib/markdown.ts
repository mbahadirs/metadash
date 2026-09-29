/**
 * Tiny Markdown subset parser for AI answers → plain data, rendered as React elements (never as HTML).
 * Blocks: paragraphs (single newlines become line breaks), bullet/numbered lists, pipe tables, headings, code fences, rules.
 * Inline: **bold**, *italic* / _italic_, `code`. Links keep only their text.
 */
export type Inline = { type: 'text' | 'bold' | 'italic' | 'code'; text: string };
export type Block =
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'heading'; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; align: ('left' | 'right' | 'center' | null)[]; rows: Inline[][][] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const FENCE = /^\s*```/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const INLINE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\s][^*\n]*?\*|(?<![\w])_[^_\s][^_\n]*?_(?![\w])|\[[^\]\n]+\]\((?:[^()\n]|\([^()\n]*\))*\))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: 'text', text: text.slice(last, idx) });
    out.push(inlineToken(m[0]));
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

function inlineToken(tok: string): Inline {
  if (tok.startsWith('**') || tok.startsWith('__')) return { type: 'bold', text: tok.slice(2, -2) };
  if (tok.startsWith('`')) return { type: 'code', text: tok.slice(1, -1) };
  if (tok.startsWith('[')) return { type: 'text', text: tok.slice(1, tok.indexOf('](')) };
  return { type: 'italic', text: tok.slice(1, -1) };
}

const isTableRow = (line: string) => line.trim().startsWith('|') || (line.includes('|') && line.trim().split('|').length > 2);

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

function alignOf(cell: string): 'left' | 'right' | 'center' | null {
  const c = cell.trim();
  if (c.startsWith(':') && c.endsWith(':')) return 'center';
  if (c.endsWith(':')) return 'right';
  if (c.startsWith(':')) return 'left';
  return null;
}

export function parseMarkdown(src: string): Block[] {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (FENCE.test(line)) {
      const end = lines.findIndex((l, j) => j > i && FENCE.test(l));
      const stop = end === -1 ? lines.length : end;
      blocks.push({ type: 'code', text: lines.slice(i + 1, stop).join('\n') });
      i = stop + 1;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i += 1;
      }
      blocks.push({ type: 'table', header: header.map(parseInline), align, rows });
      continue;
    }
    if (RULE.test(line)) { blocks.push({ type: 'rule' }); i += 1; continue; }
    const h = HEADING.exec(line);
    if (h) { blocks.push({ type: 'heading', content: parseInline(h[1]) }); i += 1; continue; }
    const listRe = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (listRe) {
      const items: Inline[][] = [];
      while (i < lines.length && listRe.test(lines[i])) {
        items.push(parseInline((listRe.exec(lines[i]) as RegExpExecArray)[1]));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: listRe === NUMBERED, items });
      continue;
    }
    const para: Inline[][] = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !(isTableRow(lines[i]) && TABLE_SEP.test(lines[i + 1] ?? ''))) {
      para.push(parseInline(lines[i]));
      i += 1;
    }
    blocks.push({ type: 'paragraph', lines: para });
  }
  return blocks;
}
