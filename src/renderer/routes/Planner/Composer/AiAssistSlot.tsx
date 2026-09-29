import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { Tabs } from '@/components/ui';
import { useAiEnabled } from '@/hooks/useAi';
import type { ComposerState } from './state';
import { CaptionAssistant } from './CaptionAssistant';
import { HashtagSuggest } from './HashtagSuggest';

type Tab = 'captions' | 'hashtags';

/**
 * Mount point for the v1.5 "AI studio" composer tools (chunk B): caption variants and hashtag suggestions, in a
 * collapsed panel. Hidden entirely while AI is off (hashtag stats alone stay available in Content analytics).
 * `postId` (optional) lets generated variants be stored in caption_variants for the post.
 */
export function AiAssistSlot({ state, disabled, onChange, postId }: {
  state: ComposerState; disabled: boolean; onChange: (patch: Partial<ComposerState>) => void; postId?: number | null;
}) {
  const t = useT();
  const enabled = useAiEnabled();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('captions');
  if (!enabled) return null;
  return (
    <details className="rounded border border-line" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs uppercase tracking-wide text-ink-2 font-medium">{t('sv_assist_title')}</summary>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <Tabs tabs={[{ id: 'captions' as Tab, label: t('sv_captions_tab') }, { id: 'hashtags' as Tab, label: t('sv_hashtags_tab') }]} value={tab} onChange={setTab} />
          {/* both stay mounted so results survive tab switches */}
          <div hidden={tab !== 'captions'}><CaptionAssistant state={state} disabled={disabled} onChange={onChange} postId={postId} /></div>
          <div hidden={tab !== 'hashtags'}><HashtagSuggest state={state} disabled={disabled} onChange={onChange} /></div>
        </div>
      )}
    </details>
  );
}
