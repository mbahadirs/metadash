import { useState, type ReactNode } from 'react';
import { useT, type Key } from '@/lib/i18n';
import type { ContentIdea } from '@/lib/types';

/** One generated idea: select for drafting, edit title / hook / caption in place. */
export function IdeaCard({ idea, selected, onToggle, onChange }: {
  idea: ContentIdea; selected: boolean; onToggle: () => void; onChange: (next: ContentIdea) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const set = (patch: Partial<ContentIdea>) => onChange({ ...idea, ...patch });
  return (
    <div className={`panel p-4 flex flex-col gap-2 ${selected ? '' : 'opacity-60'}`} style={selected ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={selected} onChange={onToggle} aria-label={idea.title} />
        <div className="min-w-0 flex-1">
          {editing
            ? <input className="input w-full" value={idea.title} maxLength={200} aria-label={t('ideas_title_label')} onChange={(e) => set({ title: e.target.value })} />
            : <div className="font-medium">{idea.title}</div>}
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
            <span className="badge badge-muted">{t(`fmt_${idea.format}` as Key)}</span>
            <span className="badge badge-muted num">{idea.suggestedDate ?? t('ideas_no_date')}</span>
            {idea.pillar && <span className="badge">{idea.pillar}</span>}
            {idea.basedOn.length > 0 && <span className="text-ink-2">{t('ideas_based_on', { n: idea.basedOn.length })}</span>}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing((v) => !v)}>{editing ? t('ideas_done') : t('ideas_edit')}</button>
      </div>
      <Field label={t('ideas_hook')}>
        {editing ? <input className="input w-full" value={idea.hook} maxLength={500} onChange={(e) => set({ hook: e.target.value })} /> : <span className="italic">{idea.hook}</span>}
      </Field>
      <Field label={t('ideas_caption')}>
        {editing
          ? <textarea className="input w-full min-h-[120px]" value={idea.captionDraft} maxLength={5000} onChange={(e) => set({ captionDraft: e.target.value })} />
          : <span className="whitespace-pre-wrap line-clamp-6">{idea.captionDraft}</span>}
      </Field>
      {idea.rationale && <Field label={t('ideas_why')}><span className="text-ink-2">{idea.rationale}</span></Field>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-ink-2 mb-0.5">{label}</div>
      {children}
    </div>
  );
}
