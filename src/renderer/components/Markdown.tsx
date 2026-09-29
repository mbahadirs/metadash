import { Fragment, useMemo } from 'react';
import { parseMarkdown, type Inline, type Block } from '@/lib/markdown';

/** Safe Markdown renderer for model output: parsed into React elements only (no HTML injection). */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="space-y-2 text-sm leading-relaxed">{blocks.map((b, i) => <BlockView key={i} block={b} />)}</div>;
}

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.type === 'bold') return <strong key={i} className="font-semibold">{it.text}</strong>;
        if (it.type === 'italic') return <em key={i}>{it.text}</em>;
        if (it.type === 'code') return <code key={i} className="px-1 rounded bg-surface-2 text-[12px]">{it.text}</code>;
        return <Fragment key={i}>{it.text}</Fragment>;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      return <div className="font-semibold"><Inlines items={block.content} /></div>;
    case 'paragraph':
      return <p>{block.lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}<Inlines items={l} /></Fragment>)}</p>;
    case 'list': {
      const items = block.items.map((it, i) => <li key={i}><Inlines items={it} /></li>);
      return block.ordered ? <ol className="list-decimal pl-5 space-y-0.5">{items}</ol> : <ul className="list-disc pl-5 space-y-0.5">{items}</ul>;
    }
    case 'table':
      return (
        <div className="overflow-auto">
          <table className="table">
            <thead><tr>{block.header.map((h, i) => <th key={i} style={{ textAlign: block.align[i] ?? undefined }}><Inlines items={h} /></th>)}</tr></thead>
            <tbody>{block.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ textAlign: block.align[ci] ?? undefined }}><Inlines items={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case 'code':
      return <pre className="p-2 rounded bg-surface-2 text-[12px] overflow-auto whitespace-pre-wrap">{block.text}</pre>;
    case 'rule':
      return <hr className="border-line" />;
    default:
      return null;
  }
}
