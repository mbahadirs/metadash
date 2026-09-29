import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';
import { InfoTip } from '@/components/ui';
import { PlatformIcon } from '@/components/PlatformBadge';
import { useAccounts } from '@/hooks/queries';
import { studio, useStudioRequest } from '@/hooks/useStudio';
import type { HashtagStat, HashtagSuggestResult } from '@/lib/types';
import { errorText } from '../lib';
import type { ComposerState } from './state';
import { SendPreview } from './SendPreview';
import { CostBadge } from './CostBadge';

type Result = HashtagSuggestResult & { count: number; platformMax: number; recommended: number | null; aiRanked?: boolean };

const TAG_IN_TEXT = /#[\p{L}\p{N}_]+/gu;

/** Appends tags that are not already in the caption, on their own line. */
export function appendTags(caption: string, tags: string[]): string {
  const present = new Set((caption.match(TAG_IN_TEXT) ?? []).map((x) => x.toLowerCase()));
  const add = tags.filter((tag) => !present.has(tag.toLowerCase()));
  if (!add.length) return caption;
  const base = caption.trimEnd();
  return `${base}${base ? '\n\n' : ''}${add.join(' ')}`;
}

function TagChip({ s, picked, onToggle, untested }: { s: { tag: string } & Partial<HashtagStat>; picked: boolean; onToggle: () => void; untested?: string }) {
  const t = useT();
  const title = untested ?? [s.posts != null ? t('sv_ht_posts', { n: s.posts }) : null, s.lift != null ? t('sv_ht_lift', { v: s.lift.toFixed(2) }) : null, s.avgReach != null ? `≈ ${fmtNum(s.avgReach)}` : null].filter(Boolean).join(' · ');
  return (
    <button type="button" className={`chip ${picked ? 'active' : ''}`} aria-pressed={picked} title={title} onClick={onToggle}>
      {s.tag}
      {s.lift != null && <span className="num text-[10px] text-ink-2 ml-1">×{s.lift.toFixed(2)}</span>}
    </button>
  );
}

/**
 * Hashtag suggestions from the account's own performance data (no AI needed): tested tags ranked by shrunk lift ×
 * relevance to the caption, plus overused and forgotten-winner lists. With "re-rank with AI" the model only
 * re-orders tested tags and may add ≤ 3 clearly labelled untested ones.
 */
export function HashtagSuggest({ state, disabled, onChange }: { state: ComposerState; disabled: boolean; onChange: (patch: Partial<ComposerState>) => void }) {
  const t = useT();
  const accounts = useAccounts({ onlyTracked: true });
  const req = useStudioRequest<Result>();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [useAi, setUseAi] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const target = state.targets.find((tg) => tg.accountId === accountId) ?? state.targets[0] ?? null;
  const name = (id: string) => accounts.data?.find((a) => a.igId === id)?.username ?? id;
  const params = useMemo(() => (target ? { accountId: target.accountId, platform: target.platform, caption: state.caption, useAi: true } : {}), [target, state.caption]);

  if (!target) return <div className="text-xs text-ink-2">{t('sv_assist_need_account')}</div>;

  const suggest = async () => {
    setError(null);
    try {
      const res = await req.run((requestId) => studio.hashtags.suggest({ accountId: target.accountId, platform: target.platform, caption: state.caption, useAi, ...(useAi ? { requestId } : {}) } as Parameters<typeof studio.hashtags.suggest>[0]) as Promise<Result>);
      setResult(res);
      setPicked(res.tested.slice(0, res.recommended ?? res.count).map((s) => s.tag));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const toggle = (tag: string) => setPicked((p) => (p.includes(tag) ? p.filter((x) => x !== tag) : [...p, tag]));
  const max = result?.platformMax ?? null;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {state.targets.length > 1 && (
          <select className="input w-auto py-0.5" value={target.accountId} onChange={(e) => { setAccountId(e.target.value); setResult(null); }} aria-label={t('sv_account')}>
            {state.targets.map((tg) => <option key={tg.accountId} value={tg.accountId}>@{name(tg.accountId)}</option>)}
          </select>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-ink-2"><PlatformIcon platform={target.platform} size={11} />@{name(target.accountId)}</span>
        <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={useAi} disabled={req.busy} onChange={(e) => setUseAi(e.target.checked)} />{t('sv_ht_use_ai')}</label>
        <button type="button" className="btn btn-sm" disabled={disabled || req.busy} onClick={() => void suggest()}>{t('sv_ht_suggest')}</button>
        {req.busy && useAi && <button type="button" className="btn btn-sm btn-ghost" onClick={req.cancel}>{t('studio_cancel')}</button>}
        <CostBadge result={result} />
      </div>
      {useAi && <SendPreview feature="hashtags" params={params} disabled={disabled} />}
      {error && <div className="text-neg">{error}</div>}
      {result && (
        <div className="space-y-2">
          <div>
            <div className="text-xs text-ink-2 mb-1">{t('sv_ht_tested')}<InfoTip text={t('sv_ht_tested_hint')} />{max != null && <span className="ml-2">{t('sv_ht_limit', { n: max, r: result.recommended ?? max })}</span>}</div>
            {result.tested.length ? (
              <div className="flex flex-wrap gap-1">{result.tested.map((s) => <TagChip key={s.tag} s={s} picked={picked.includes(s.tag)} onToggle={() => toggle(s.tag)} />)}</div>
            ) : <div className="text-xs text-ink-2">{t('sv_ht_none')}</div>}
          </div>
          {result.untested.length > 0 && (
            <div>
              <div className="text-xs text-ink-2 mb-1">{t('sv_ht_untested')}</div>
              <div className="flex flex-wrap gap-1">{result.untested.map((u) => <TagChip key={u.tag} s={u} untested={u.reason} picked={picked.includes(u.tag)} onToggle={() => toggle(u.tag)} />)}</div>
            </div>
          )}
          {result.stale.length > 0 && (
            <div>
              <div className="text-xs text-ink-2 mb-1">{t('sv_ht_stale')}<InfoTip text={t('sv_ht_stale_hint')} /></div>
              <div className="flex flex-wrap gap-1">{result.stale.map((s) => <TagChip key={s.tag} s={s} picked={picked.includes(s.tag)} onToggle={() => toggle(s.tag)} />)}</div>
            </div>
          )}
          {result.overused.length > 0 && (
            <div className="text-xs text-ink-2">{t('sv_ht_overused')}<InfoTip text={t('sv_ht_overused_hint')} />: {result.overused.map((s) => s.tag).join(' ')}</div>
          )}
          <button type="button" className="btn btn-sm btn-primary" disabled={disabled || !picked.length || (max != null && picked.length > max)} onClick={() => onChange({ caption: appendTags(state.caption, picked) })}>
            {t('sv_ht_add_all')} ({picked.length})
          </button>
        </div>
      )}
    </div>
  );
}
