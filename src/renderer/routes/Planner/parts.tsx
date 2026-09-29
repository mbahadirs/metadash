import { useMemo, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { useAccounts } from '@/hooks/queries';
import { PlatformIcon } from '@/components/PlatformBadge';
import { Modal } from '@/components/ui';
import { mediaUrl, type Account, type Issue, type PlannerTargetSummary, type PostStatus, type TargetState } from '@/lib/types';
import { thumbGradient } from '@/lib/format';
import { STATUS_BADGE, STATUS_COLOR, TARGET_BADGE, issueText, sortIssues, tx } from './lib';

export function StatusBadge({ status }: { status: PostStatus }) {
  const t = useT();
  return <span className={`badge ${STATUS_BADGE[status]}`} style={status === 'scheduled' || status === 'publishing' ? { color: STATUS_COLOR[status], background: 'var(--accent-soft)' } : undefined}>{t(`st_${status}`)}</span>;
}

export function TargetStateBadge({ state }: { state: TargetState }) {
  const lang = useAppStore((s) => s.lang);
  return <span className={`badge ${TARGET_BADGE[state]}`}>{tx(`ts_${state}`, lang, undefined, state)}</span>;
}

/** Tracked accounts by id (planner targets reference accounts.ig_id). */
export function useAccountMap() {
  const q = useAccounts({ onlyTracked: true });
  return useMemo(() => new Map<string, Account>((q.data ?? []).map((a) => [a.igId, a])), [q.data]);
}

export function TargetDots({ targets, max = 4 }: { targets: PlannerTargetSummary[]; max?: number }) {
  const accounts = useAccountMap();
  const shown = targets.slice(0, max);
  return (
    <span className="inline-flex items-center gap-0.5">
      {shown.map((tg) => <PlatformIcon key={tg.id} platform={tg.platform} size={12} title={`@${accounts.get(tg.accountId)?.username ?? tg.accountId}`} />)}
      {targets.length > max && <span className="text-[10px] text-ink-2">+{targets.length - max}</span>}
    </span>
  );
}

/** Asset thumbnail via mdmedia://asset/<id>/thumb, with a deterministic gradient fallback. */
export function AssetThumb({ assetId, size = 36, alt = '', kind }: { assetId: number | null | undefined; size?: number; alt?: string; kind?: 'image' | 'video' }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (assetId == null || failed) return <span className="rounded flex-none inline-block" style={{ ...style, background: thumbGradient(String(assetId ?? 'none')) }} aria-hidden />;
  return (
    <span className="relative flex-none inline-block" style={style}>
      <img src={mediaUrl(assetId, 'thumb')} alt={alt} className="rounded object-cover" style={style} onError={() => setFailed(true)} draggable={false} />
      {kind === 'video' && <span className="absolute bottom-0 right-0 text-[9px] px-0.5 rounded bg-black/60 text-white" aria-hidden>▶</span>}
    </span>
  );
}

const LEVEL_CLS: Record<Issue['level'], string> = { error: 'text-neg', warn: 'text-warn', info: 'text-ink-2' };
const LEVEL_MARK: Record<Issue['level'], string> = { error: '●', warn: '▲', info: 'i' };

export function IssueList({ issues, accounts, empty }: { issues: Issue[]; accounts?: Map<string, Account>; empty?: ReactNode }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  if (!issues.length) return <>{empty ?? null}</>;
  return (
    <ul className="space-y-1 text-sm">
      {sortIssues(issues).map((i, idx) => (
        <li key={`${i.code}-${i.targetId ?? i.accountId ?? ''}-${i.assetId ?? ''}-${idx}`} className="flex gap-2 items-start">
          <span className={`${LEVEL_CLS[i.level]} text-[10px] mt-1 w-3 flex-none text-center`} aria-label={t(`lvl_${i.level}`)}>{LEVEL_MARK[i.level]}</span>
          <span className="flex-1">
            {i.platform && <PlatformIcon platform={i.platform} size={12} />}{' '}
            {i.accountId && accounts?.get(i.accountId) && <span className="text-ink-2">@{accounts.get(i.accountId)!.username}: </span>}
            {issueText(i, lang)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function IssueCount({ issues }: { issues: Issue[] }) {
  const t = useT();
  const e = issues.filter((i) => i.level === 'error').length;
  const w = issues.filter((i) => i.level === 'warn').length;
  return (
    <span className="inline-flex gap-1">
      {e > 0 && <span className="badge badge-neg">{t('pl_errors_n', { n: e })}</span>}
      {w > 0 && <span className="badge badge-warn">{t('pl_warnings_n', { n: w })}</span>}
      {!e && !w && <span className="badge badge-pos">{t('pl_ready')}</span>}
    </span>
  );
}

/** Small modal with one text field (notes, approver names, pasted codes). */
export function PromptDialog({ open, title, label, placeholder, multiline, confirmLabel, required, onClose, onSubmit, children }: {
  open: boolean; title: string; label: string; placeholder?: string; multiline?: boolean; confirmLabel: string; required?: boolean;
  onClose: () => void; onSubmit: (value: string) => void | Promise<void>; children?: ReactNode;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (required && !value.trim()) return;
    setBusy(true);
    try { await onSubmit(value.trim()); setValue(''); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} width={480}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <label className="block text-sm">
          <span className="text-ink-2">{label}</span>
          {multiline
            ? <textarea className="input mt-1" rows={5} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
            : <input className="input mt-1" value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />}
        </label>
        {children}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || (required && !value.trim())}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({ open, title, text, confirmLabel, danger, onClose, onConfirm }: {
  open: boolean; title: string; text: string; confirmLabel: string; danger?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={title} width={440}>
      <p className="text-sm mb-4">{text}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose} autoFocus>{t('cancel')}</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
