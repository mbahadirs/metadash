import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline } from '../src/renderer/lib/markdown.ts';

describe('parseInline', () => {
  it('handles bold, italic, code and links (text only)', () => {
    expect(parseInline('a **b** *c* `d` [e](javascript:alert(1)) _f_')).toEqual([
      { type: 'text', text: 'a ' }, { type: 'bold', text: 'b' }, { type: 'text', text: ' ' }, { type: 'italic', text: 'c' },
      { type: 'text', text: ' ' }, { type: 'code', text: 'd' }, { type: 'text', text: ' ' }, { type: 'text', text: 'e' },
      { type: 'text', text: ' ' }, { type: 'italic', text: 'f' },
    ]);
  });
  it('keeps snake_case identifiers and HTML as plain text', () => {
    expect(parseInline('media_latest engagement_rate')).toEqual([{ type: 'text', text: 'media_latest engagement_rate' }]);
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses paragraphs with line breaks, lists and headings', () => {
    const b = parseMarkdown('# Title\nLine one\nLine two\n\n- a\n- **b**\n\n1. x\n2) y');
    expect(b.map((x) => x.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(b[1].lines).toHaveLength(2);
    expect(b[2]).toMatchObject({ ordered: false, items: [[{ type: 'text', text: 'a' }], [{ type: 'bold', text: 'b' }]] });
    expect(b[3]).toMatchObject({ ordered: true });
  });
  it('parses pipe tables with alignment', () => {
    const [t] = parseMarkdown('| Account | Spend |\n|:---|---:|\n| @a | 1,200 TRY |\n| @b | 90 USD |');
    expect(t.type).toBe('table');
    expect(t.align).toEqual(['left', 'right']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1][1]).toEqual([{ type: 'text', text: '90 USD' }]);
  });
  it('parses code fences and rules; tolerates empty input', () => {
    const b = parseMarkdown('```sql\nSELECT 1\n```\n---\ntext');
    expect(b).toEqual([{ type: 'code', text: 'SELECT 1' }, { type: 'rule' }, { type: 'paragraph', lines: [[{ type: 'text', text: 'text' }]] }]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown(undefined)).toEqual([]);
  });
});
