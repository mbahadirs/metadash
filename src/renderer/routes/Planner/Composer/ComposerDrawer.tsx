import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { useAccounts } from '@/hooks/queries';
import { PLANNER_KEY, plannerApi, usePlannerPost, usePlannerSettings, usePublishingReadiness } from '@/hooks/usePlanner';
import { Loading, Spinner, Tabs } from '@/components/ui';
import type { Account, Issue, PlannerPost } from '@/lib/types';
import { useToast } from '../Toast';
import { ConfirmDialog, StatusBadge } from '../parts';
import { errorCode, errorText, hasErrors, inferFormat, isContentLocked } from '../lib';
import { AccountPicker } from './AccountPicker';
import { MediaTray } from './MediaTray';
import { CaptionEditor } from './CaptionEditor';
import { SchedulePicker } from './SchedulePicker';
import { ValidationPanel } from './ValidationPanel';
import { PreviewPane } from './PreviewPane';
import { WorkflowBar } from './WorkflowBar';
import { PostHistory } from './PostHistory';
import { AiAssistSlot } from './AiAssistSlot';
import { WorkerExecutorToggle } from './WorkerExecutorToggle';
import { contentKey, emptyState, fromPost, toCreate, toDraft, toPatch, type ComposerSeed, type ComposerState } from './state';

const AUTOSAVE_MS = 1200;
const VALIDATE_MS = 300;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Server post → composer state, treating a stored format equal to the inferred one as "auto". */
function hydrate(p: PlannerPost): ComposerState {
  const s = fromPost(p);
  const media = s.media.map((m) => m.asset);
  return { ...s, targets: s.targets.map((tg) => (tg.format === inferFormat(tg.platform, media) ? { ...tg, format: null } : tg)) };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs uppercase tracking-wide text-ink-2 font-medium">{label}</h3>
      {children}
    </section>
  );
}

/**
 * Right-side post composer (full width on narrow windows). New posts are created on "Save draft" (or the first
 * workflow action); existing posts autosave (debounced update with expectedVersion; VERSION_CONFLICT shows a banner).
 * Time changes go straight to planner:posts:reschedule. Esc closes, Cmd/Ctrl+S saves.
 */
export function ComposerDrawer({ postId, seed, onClose, onOpenPost }: {
  postId: number | null; seed?: ComposerSeed; onClose: () => void; onOpenPost: (id: number) => void;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = usePlannerSettings();
  const accountsQ = useAccounts({ onlyTracked: true });
  const accountsList = useMemo<Account[]>(() => accountsQ.data ?? [], [accountsQ.data]);
  const accounts = useMemo(() => new Map(accountsList.map((a) => [a.igId, a])), [accountsList]);
  const readinessQ = usePublishingReadiness();

  const [id, setId] = useState<number | null>(postId);
  const postQ = usePlannerPost(id);
  const post = id != null ? postQ.data ?? null : null;
  const [form, setForm] = useState<ComposerState>(() => emptyState(seed));
  const [savedKey, setSavedKey] = useState<string>(() => (postId == null ? contentKey(emptyState(seed)) : ''));
  const versionRef = useRef<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [tab, setTab] = useState<'compose' | 'history'>('compose');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const saving = useRef<Promise<PlannerPost | null> | null>(null);
  const hydratedAt = useRef<number>(0);

  const formKey = contentKey(form);
  const dirty = formKey !== savedKey;
  const locked = post ? isContentLocked(post.status) : false;

  useEffect(() => { setId(postId); setConflict(false); setTab('compose'); }, [postId]);

  // Seeded accounts (e.g. "Duplicate as draft" from an analytics post) once the account list has loaded.
  const seededAccounts = useRef(false);
  useEffect(() => {
    if (seededAccounts.current || postId != null || !seed?.accountIds?.length || !accountsList.length) return;
    seededAccounts.current = true;
    const picked = accountsList.filter((a) => seed.accountIds!.includes(a.igId));
    if (picked.length) setForm((f) => ({ ...f, targets: picked.map((a) => ({ accountId: a.igId, platform: a.platform, format: null, captionOverride: null, firstCommentOverride: null, options: {}, mode: 'app' as const })) }));
  }, [accountsList, postId, seed]);

  // Hydrate from the server when there are no local edits (also after worker/other-window changes).
  useEffect(() => {
    if (!post || postQ.dataUpdatedAt === hydratedAt.current) return;
    if (dirty && savedKey !== '') return;
    hydratedAt.current = postQ.dataUpdatedAt;
    const next = hydrate(post);
    setForm(next);
    setSavedKey(contentKey(next));
    versionRef.current = post.version;
  }, [post, postQ.dataUpdatedAt, dirty, savedKey]);

  const save = useCallback(async (opts: { force?: boolean } = {}): Promise<PlannerPost | null> => {
    if (saving.current) await saving.current.catch(() => null);
    const snapshot = form;
    const key = contentKey(snapshot);
    const job = (async () => {
      setSaveState('saving');
      try {
        let res: PlannerPost;
        if (id == null) {
          res = await plannerApi.create(toCreate(snapshot));
          qc.setQueryData([PLANNER_KEY, 'post', res.id], res);
          setId(res.id);
          onOpenPost(res.id);
        } else {
          res = await plannerApi.update({ id, patch: toPatch(snapshot), ...(opts.force || versionRef.current == null ? {} : { expectedVersion: versionRef.current }) });
        }
        versionRef.current = res.version;
        setSavedKey(key);
        qc.setQueryData([PLANNER_KEY, 'post', res.id], res);
        hydratedAt.current = qc.getQueryState([PLANNER_KEY, 'post', res.id])?.dataUpdatedAt ?? Date.now();
        setConflict(false);
        setSaveState('saved');
        return res;
      } catch (e) {
        if (errorCode(e) === 'VERSION_CONFLICT') setConflict(true);
        else toast(errorText(e), 'error');
        setSaveState('error');
        return null;
      }
    })();
    saving.current = job;
    try { return await job; } finally { if (saving.current === job) saving.current = null; }
  }, [form, id, onOpenPost, qc, toast]);

  // Autosave existing posts.
  useEffect(() => {
    if (id == null || !dirty || conflict || locked || savedKey === '') return;
    const h = setTimeout(() => { void save(); }, AUTOSAVE_MS);
    return () => clearTimeout(h);
  }, [formKey, id, dirty, conflict, locked, savedKey, save]);

  // Live validation of the unsaved state.
  useEffect(() => {
    let alive = true;
    setValidating(true);
    const h = setTimeout(async () => {
      try {
        const res = await plannerApi.validate(toDraft(form, id));
        if (alive) { setIssues(res); setValidateError(null); }
      } catch (e) {
        if (alive) setValidateError(errorText(e));
      } finally {
        if (alive) setValidating(false);
      }
    }, VALIDATE_MS);
    return () => { alive = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey, form.scheduledAt, id]);

  /** Saves pending edits (or creates the post) and returns the stored post. */
  const flush = useCallback(async (): Promise<PlannerPost | null> => {
    if (conflict) { toast(t('pl_conflict'), 'error'); return null; }
    if (id == null || dirty) return save();
    return post ?? (await postQ.refetch()).data ?? null;
  }, [conflict, id, dirty, save, post, postQ, t, toast]);

  const setTime = async (at: number | null) => {
    const prev = form.scheduledAt;
    setForm((f) => ({ ...f, scheduledAt: at }));
    if (id == null) return;
    try {
      const res = await plannerApi.reschedule(id, at);
      if (res.warnings?.length) toast(t('pl_warnings_n', { n: res.warnings.length }), 'info');
    } catch (e) {
      setForm((f) => ({ ...f, scheduledAt: prev }));
      toast(errorText(e), 'error');
    }
  };

  const requestClose = useCallback(async () => {
    if (id == null && dirty) { setConfirmDiscard(true); return; }
    if (id != null && dirty && !conflict && !locked) await save();
    onClose();
  }, [id, dirty, conflict, locked, save, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelectorAll('[role="dialog"][aria-modal]').length > 1) return; // a nested dialog handles it
      if (e.key === 'Escape') { e.preventDefault(); void requestClose(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!locked) void save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, save, locked]);

  const patch = (p: Partial<ComposerState>) => setForm((f) => ({ ...f, ...p }));
  const loading = id != null && postQ.isLoading;
  const disabled = locked || conflict;
  const status = post?.status ?? 'draft';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal aria-label={post ? `${t('pl_edit_post')} ${post.ref}` : t('pl_new_post')}>
      <div className="flex-1 bg-black/45 hidden md:block" onMouseDown={() => void requestClose()} />
      <aside className="w-full md:w-[1080px] md:max-w-[96vw] h-full bg-surface-1 border-l border-line shadow-2xl flex flex-col">
        <header className="flex items-center gap-3 px-5 h-14 border-b border-line flex-none">
          {post && <span className="num text-ink-2 text-sm">{post.ref}</span>}
          <StatusBadge status={status} />
          <input className="input flex-1 font-medium" value={form.title} disabled={disabled} placeholder={t('pl_title_placeholder')} aria-label={t('pl_title')}
            onChange={(e) => patch({ title: e.target.value })} />
          <span className="text-xs text-ink-2 min-w-[90px] text-right" aria-live="polite">
            {saveState === 'saving' ? <span className="inline-flex items-center gap-1"><Spinner size={12} />{t('pl_saving')}</span>
              : dirty ? t('pl_unsaved') : id != null ? t('pl_saved') : ''}
          </span>
          {id == null && <button type="button" className="btn btn-sm" onClick={() => void save()} disabled={saveState === 'saving'}>{t('pl_save_draft')}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void requestClose()} aria-label={t('close')}>✕</button>
        </header>

        {conflict && (
          <div className="px-5 py-2 text-sm flex items-center gap-2 border-b border-line" style={{ background: 'rgba(232, 180, 74, 0.15)' }} role="alert">
            <span className="flex-1">{t('pl_conflict')}</span>
            <button type="button" className="btn btn-sm" onClick={async () => {
              const fresh = (await postQ.refetch()).data;
              if (fresh) { const next = hydrate(fresh); setForm(next); setSavedKey(contentKey(next)); versionRef.current = fresh.version; }
              setConflict(false);
            }}>{t('pl_conflict_reload')}</button>
            <button type="button" className="btn btn-sm" onClick={() => { setConflict(false); void save({ force: true }); }}>{t('pl_conflict_overwrite')}</button>
          </div>
        )}
        {locked && <div className="px-5 py-2 text-sm text-ink-2 border-b border-line">{t('pl_locked_hint')}</div>}
        {!locked && settings.requireApproval && (status === 'approved' || status === 'scheduled') && (
          <div className="px-5 py-2 text-xs text-warn border-b border-line">{t('pl_edit_invalidates')}</div>
        )}

        {id != null && (
          <div className="px-5 flex-none">
            <Tabs tabs={[{ id: 'compose', label: t('pl_tab_compose') }, { id: 'history', label: t('pl_tab_results') }]} value={tab} onChange={setTab} />
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading ? <Loading /> : tab === 'history' && post ? (
            <div className="p-5"><PostHistory post={post} accounts={accounts} /></div>
          ) : (
            <div className="grid md:grid-cols-[minmax(0,1fr)_340px] gap-6 p-5">
              <div className="space-y-5 min-w-0">
                <Field label={t('pl_accounts')}>
                  <AccountPicker accounts={accountsList} targets={form.targets} media={form.media} readiness={readinessQ.data ?? null} disabled={disabled}
                    onChange={(targets) => patch({ targets })} />
                </Field>
                <Field label={t('pl_media')}>
                  <MediaTray media={form.media} issues={issues} disabled={disabled} onChange={(media) => patch({ media })} />
                </Field>
                <Field label={t('pl_caption')}>
                  <CaptionEditor state={form} accounts={accounts} disabled={disabled} onChange={patch} />
                </Field>
                <AiAssistSlot state={form} disabled={disabled} onChange={patch} postId={id} />
                <Field label={t('pl_schedule_section')}>
                  <SchedulePicker scheduledAt={form.scheduledAt} accountIds={form.targets.map((tg) => tg.accountId)} disabled={disabled || status === 'publishing'} onChange={(at) => void setTime(at)} />
                </Field>
                {post && <WorkerExecutorToggle post={post} accounts={accounts} />}
                <Field label={t('pl_internal')}>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <input className="input" value={form.clientName} disabled={disabled} placeholder={t('pl_client_name')} aria-label={t('pl_client_name')} onChange={(e) => patch({ clientName: e.target.value })} />
                    <input className="input" value={form.notes} disabled={disabled} placeholder={t('pl_notes')} aria-label={t('pl_notes')} onChange={(e) => patch({ notes: e.target.value })} />
                  </div>
                </Field>
              </div>
              <div className="space-y-5 min-w-0">
                <Field label={t('pl_checks')}>
                  <ValidationPanel issues={issues} loading={validating} failed={validateError} accounts={accounts} />
                </Field>
                <Field label={t('pl_preview')}>
                  <PreviewPane state={form} accounts={accounts} />
                </Field>
              </div>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-line flex-none">
          <WorkflowBar post={post} requireApproval={settings.requireApproval} blocked={hasErrors(issues)} hasTime={form.scheduledAt != null}
            busy={saveState === 'saving'} onFlush={flush} onDuplicated={onOpenPost} onDeleted={onClose} />
        </footer>
      </aside>
      <ConfirmDialog open={confirmDiscard} danger title={t('pl_discard_title')} text={t('pl_discard_text')} confirmLabel={t('pl_discard')}
        onClose={() => setConfirmDiscard(false)} onConfirm={onClose} />
    </div>
  );
}
