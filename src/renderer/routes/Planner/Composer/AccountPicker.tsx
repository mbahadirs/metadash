import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { PlatformIcon } from '@/components/PlatformBadge';
import { PLATFORMS, PLATFORM_LABELS } from '@/lib/platforms';
import type { Account, PlannerFormat, PublishingReadiness } from '@/lib/types';
import { FORMATS, inferFormat, tx } from '../lib';
import type { ComposerMedia, ComposerTarget } from './state';

/** Accounts across Instagram / Facebook / Threads plus per-target format, Facebook native scheduling and link. */
export function AccountPicker({ accounts, targets, media, readiness, disabled, onChange }: {
  accounts: Account[]; targets: ComposerTarget[]; media: ComposerMedia[]; readiness: PublishingReadiness | null; disabled: boolean;
  onChange: (targets: ComposerTarget[]) => void;
}) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const [search, setSearch] = useState('');
  const selected = new Set(targets.map((tg) => tg.accountId));
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => !q || a.username.toLowerCase().includes(q) || (a.name ?? '').toLowerCase().includes(q) || (a.clientName ?? '').toLowerCase().includes(q));
  }, [accounts, search]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.igId, a])), [accounts]);
  const mediaMeta = media.map((m) => m.asset);

  const toggle = (a: Account) => {
    if (selected.has(a.igId)) onChange(targets.filter((tg) => tg.accountId !== a.igId));
    else onChange([...targets, { accountId: a.igId, platform: a.platform, format: null, captionOverride: null, firstCommentOverride: null, options: {}, mode: 'app' }]);
  };
  const patch = (accountId: string, p: Partial<ComposerTarget>) => onChange(targets.map((tg) => (tg.accountId === accountId ? { ...tg, ...p } : tg)));

  return (
    <div className="space-y-2">
      {accounts.length > 8 && (
        <input className="input" placeholder={t('pl_search_accounts')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('pl_search_accounts')} />
      )}
      <div className="max-h-40 overflow-auto flex flex-wrap gap-1" role="group" aria-label={t('pl_accounts')}>
        {PLATFORMS.flatMap((p) => filtered.filter((a) => a.platform === p)).map((a) => (
          <button type="button" key={a.igId} className={`chip ${selected.has(a.igId) ? 'active' : ''}`} aria-pressed={selected.has(a.igId)} disabled={disabled} onClick={() => toggle(a)}>
            <PlatformIcon platform={a.platform} size={12} />@{a.username}
          </button>
        ))}
        {!filtered.length && <span className="text-ink-2 text-sm">{t('pl_no_accounts')}</span>}
      </div>
      {targets.length > 0 && (
        <ul className="space-y-1.5">
          {targets.map((tg) => {
            const acc = byId.get(tg.accountId);
            const auto = inferFormat(tg.platform, mediaMeta);
            const ready = readiness?.[tg.platform];
            const pageReady = tg.platform === 'facebook' ? readiness?.facebook.pages.find((p) => p.accountId === tg.accountId) : null;
            const blocked = ready ? !ready.canPublish || pageReady?.canPublish === false : false;
            const format = tg.format ?? auto;
            return (
              <li key={tg.accountId} className="flex flex-wrap items-center gap-2 text-sm border border-line rounded px-2 py-1.5">
                <PlatformIcon platform={tg.platform} size={14} />
                <span className="font-medium">@{acc?.username ?? tg.accountId}</span>
                <label className="flex items-center gap-1 text-ink-2">
                  <span className="sr-only">{t('pl_format')}</span>
                  <select className="input h-7 w-auto py-0" value={tg.format ?? ''} disabled={disabled} aria-label={`${t('pl_format')} @${acc?.username ?? ''}`}
                    onChange={(e) => patch(tg.accountId, { format: (e.target.value || null) as PlannerFormat | null })}>
                    <option value="">{t('pl_format_auto', { f: auto ? tx(`fmt_${auto}`, lang, undefined, auto) : '—' })}</option>
                    {FORMATS[tg.platform].map((f) => <option key={f} value={f}>{tx(`fmt_${f}`, lang, undefined, f)}</option>)}
                  </select>
                </label>
                {tg.platform === 'facebook' && (
                  <label className="flex items-center gap-1 text-xs" title={t('pl_fb_native_hint')}>
                    <input type="checkbox" checked={tg.mode === 'native'} disabled={disabled} onChange={(e) => patch(tg.accountId, { mode: e.target.checked ? 'native' : 'app' })} />
                    {t('pl_fb_native')}
                  </label>
                )}
                {tg.platform === 'facebook' && format === 'link' && (
                  <input className="input h-7 flex-1 min-w-[180px]" type="url" placeholder="https://" value={tg.options.link ?? ''} disabled={disabled} aria-label={t('pl_link')}
                    onChange={(e) => patch(tg.accountId, { options: { ...tg.options, link: e.target.value || undefined } })} />
                )}
                {blocked && <span className="badge badge-warn" title={ready?.missingScopes?.join(', ')}>{t('pl_no_publish_permission')}</span>}
                <button type="button" className="btn btn-ghost btn-sm ml-auto" disabled={disabled} onClick={() => onChange(targets.filter((x) => x.accountId !== tg.accountId))} aria-label={`${t('pl_remove')} @${acc?.username ?? ''}`}>✕</button>
              </li>
            );
          })}
        </ul>
      )}
      {!targets.length && <div className="text-xs text-ink-2">{t('pl_pick_accounts_hint', { platforms: PLATFORMS.map((p) => PLATFORM_LABELS[p]).join(' / ') })}</div>}
    </div>
  );
}
