import { useMemo, useRef, useState } from 'react';
import type { TeamMember } from '@/lib/types';
import { useTeamMembers } from '@/hooks/useTeam';

const TOKEN = /(^|[^\w@.])@([a-z0-9_.-]{0,32})$/i;
const MAX_SUGGESTIONS = 6;

/**
 * Textarea with @handle autocomplete against the team members. Picked members are reported through
 * onMentionsChange (ids); the main process also resolves @handles typed by hand.
 */
export function MentionInput({ value, onChange, mentions, onMentionsChange, placeholder, rows = 2, onSubmit }: {
  value: string; onChange: (v: string) => void; mentions: string[]; onMentionsChange: (ids: string[]) => void;
  placeholder?: string; rows?: number; onSubmit?: () => void;
}) {
  const members = useTeamMembers();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = useMemo<TeamMember[]>(() => {
    if (query == null) return [];
    const q = query.toLowerCase();
    return (members.data ?? []).filter((m) => m.handle && (m.handle.toLowerCase().startsWith(q) || m.name.toLowerCase().includes(q))).slice(0, MAX_SUGGESTIONS);
  }, [query, members.data]);

  const update = (text: string, caret: number) => {
    onChange(text);
    const m = TOKEN.exec(text.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
  };

  const pick = (m: TeamMember) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([a-z0-9_.-]{0,32})$/i, `@${m.handle} `);
    const next = before + value.slice(caret);
    onChange(next);
    if (!mentions.includes(m.id)) onMentionsChange([...mentions, m.id]);
    setQuery(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };

  return (
    <div className="relative flex-1">
      <textarea
        ref={ref} className="input w-full" rows={rows} placeholder={placeholder} value={value}
        onChange={(e) => update(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={(e) => {
          if (suggestions.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active]); return; }
            if (e.key === 'Escape') { setQuery(null); return; }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-autocomplete="list"
      />
      {suggestions.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 panel shadow-lg text-sm max-h-48 overflow-auto" role="listbox">
          {suggestions.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button type="button" className={`w-full text-left px-3 py-1.5 ${i === active ? 'bg-surface-2' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
                <span className="font-medium">@{m.handle}</span> <span className="text-ink-2">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
