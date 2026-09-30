import { useState, type Ref } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT, type Key } from '@/lib/i18n';
import { useAppStore } from '@/store/app';
import { fmtNum } from '@/lib/format';
import { Modal, Spinner } from '@/components/ui';
import { studio, useSendPreview, useStudioRequest, fmtUsd, STUDIO_KEY } from '@/hooks/useStudio';
import type { ReplySuggestResult, StudioCapabilities } from '@/lib/types';
import { CostLine } from '../parts';
import { thirdPartyMentions } from '@/routes/Inbox/format';

const REPLY_MAX = 2200;

/** The comment fields the composer needs (Studio InboxRow and the unified InboxRow both fit). */
export interface ComposerItem { commentId: string; username: string; accountUsername?: string | null; aiDisabled?: boolean }

/**
 * Optional overrides for the unified inbox (v2.0): the platform's reply limit, the send / mark-done calls
 * (inbox:reply with confirmed: true, inbox:setStatus) and a ref to focus the editor (keyboard shortcut r).
 */
export interface ComposerOptions {
  maxLength?: number;
  send?: (text: string) => Promise<{ demo?: boolean }>;
  dismiss?: () => Promise<unknown>;
  textareaRef?: Ref<HTMLTextAreaElement>;
  platformLabel?: string;
  suggest?: (p: { requestId: string; commentId: string; lang: string }) => Promise<ReplySuggestResult>;
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Reply editor for one comment: optional AI suggestions (3 + category), free editing, and an explicit confirmation
 * dialog before every send (studio:replies:send with confirmed: true). "Mark done" closes the comment without replying.
 */
export function ReplyComposer({ item, caps, onDone, options = {} }: { item: ComposerItem; caps: StudioCapabilities | undefined; onDone: (msg: string) => void; options?: ComposerOptions }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const demo = useAppStore((s) => s.demo);
  const qc = useQueryClient();
  const req = useStudioRequest<ReplySuggestResult>();
  const [text, setText] = useState('');
  const [result, setResult] = useState<ReplySuggestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSent, setShowSent] = useState(false);
  const aiBlocked = item.aiDisabled === true || caps?.enabled === false;
  const max = options.maxLength ?? REPLY_MAX;

  const refreshInbox = () => Promise.all([qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'inbox'] }), qc.invalidateQueries({ queryKey: ['inbox'] })]);

  const suggest = async () => {
    setError(null);
    try {
      const res = await req.run((requestId) => (options.suggest ?? studio.replies.suggest)({ requestId, commentId: item.commentId, lang }));
      setResult(res);
      if (!text.trim() && res.suggestions[0]) setText(res.suggestions[0]);
    } catch (e) {
      setError(errText(e));
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = options.send
        ? await options.send(text.trim())
        : await studio.call<{ replyId: string; demo?: boolean }>('replies:send', { commentId: item.commentId, text: text.trim(), confirmed: true });
      setConfirming(false);
      setText('');
      onDone(res.demo ? t('ib_sent_demo') : t('ib_sent'));
      refreshInbox();
    } catch (e) {
      setConfirming(false);
      setError(errText(e));
    } finally {
      setSending(false);
    }
  };

  const dismiss = async () => {
    setError(null);
    try {
      await (options.dismiss ? options.dismiss() : studio.replies.dismiss(item.commentId));
      refreshInbox();
    } catch (e) {
      setError(errText(e));
    }
  };

  const trimmed = text.trim();
  const mentions = thirdPartyMentions(trimmed, item.username, item.accountUsername ?? '');
  return (
    <div className="space-y-2">
      {!aiBlocked && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm" disabled={req.busy} onClick={suggest}>
            {req.busy ? <Spinner size={12} /> : null}{result ? t('ib_suggest_again') : t('ib_suggest')}
          </button>
          {req.busy && <button className="btn btn-ghost btn-sm" onClick={req.cancel}>{t('ib_cancel')}</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSent((v) => !v)} aria-expanded={showSent}>{t('ib_what_sent')}</button>
          {result && <CostLine usage={result.usage} costUsd={result.costUsd} caps={caps} />}
        </div>
      )}
      {aiBlocked && item.aiDisabled && <div className="text-xs text-ink-2">{t('ib_ai_disabled')}</div>}
      {showSent && !aiBlocked && <SendPreviewPanel commentId={item.commentId} caps={caps} />}
      {result && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`badge ${result.category === 'complaint' ? 'badge-warn' : result.category === 'spam' ? 'badge-neg' : 'badge-muted'}`}>{t(`ib_cat_${result.category}` as Key)}</span>
            {result.category === 'complaint' && <span className="text-xs text-ink-2">{t('ib_complaint_hint')}</span>}
          </div>
          {result.suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 rounded border border-line p-2 text-sm">
              <div className="flex-1 whitespace-pre-wrap select-text">{s}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setText(s)}>{t('ib_use')}</button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={options.textareaRef}
        className="input text-sm"
        rows={3}
        maxLength={max}
        placeholder={t('ib_reply_placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={t('ib_reply_placeholder')}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs num ${trimmed.length > max * 0.9 ? 'text-warn' : 'text-ink-2'}`}>{t('ib_chars_of', { n: fmtNum(trimmed.length), max: fmtNum(max) })}</span>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>{t('ib_mark_done')}</button>
          <button className="btn btn-primary btn-sm" disabled={!trimmed || trimmed.length > max} onClick={() => setConfirming(true)}>{t('ib_send')}</button>
        </div>
      </div>
      {error && <div className="text-xs text-neg select-text">{error}</div>}
      <Modal open={confirming} onClose={() => !sending && setConfirming(false)} title={t('ib_confirm_title')} width={520}>
        <div className="space-y-3 text-sm">
          <div className="text-ink-2">{t('ib_confirm_body', { account: item.accountUsername ?? '', user: item.username })}</div>
          <div className="rounded border border-line p-3 whitespace-pre-wrap select-text">{trimmed}</div>
          {mentions.length > 0 && <div className="text-xs text-warn">{t('ib_confirm_mentions', { handles: mentions.map((h) => `@${h}`).join(', ') })}</div>}
          {options.platformLabel && <div className="text-xs text-ink-2">{t('ib_confirm_platform', { platform: options.platformLabel })}</div>}
          {demo && <div className="text-xs text-warn">{t('ib_confirm_demo')}</div>}
          <div className="flex justify-end gap-2">
            <button className="btn" disabled={sending} onClick={() => setConfirming(false)}>{t('ib_cancel')}</button>
            <button className="btn btn-primary" disabled={sending} onClick={send} autoFocus>{sending ? <Spinner size={12} /> : null}{t('ib_confirm_send')}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const PREVIEW_LABELS: Record<string, Key> = { comment: 'ib_sent_comment', caption: 'ib_sent_caption', brief: 'ib_sent_brief' };

function SendPreviewPanel({ commentId, caps }: { commentId: string; caps: StudioCapabilities | undefined }) {
  const t = useT();
  const preview = useSendPreview('reply', { commentId }, true);
  if (preview.isLoading) return <Spinner size={12} />;
  if (preview.error) return <div className="text-xs text-neg">{errText(preview.error)}</div>;
  const p = preview.data;
  if (!p) return null;
  const cost = p.local ? t('studio_cost_local') : p.estCostUsd == null ? t('studio_cost_unknown') : fmtUsd(p.estCostUsd);
  return (
    <div className="rounded border border-line p-2 text-xs text-ink-2 space-y-1">
      {p.items.map((it) => (
        <div key={it.label} className="flex justify-between gap-3">
          <span>{PREVIEW_LABELS[it.label] ? t(PREVIEW_LABELS[it.label]) : it.label}</span>
          {it.chars != null && <span className="num">{t('ib_chars', { n: fmtNum(it.chars) })}</span>}
        </div>
      ))}
      {caps?.showCost !== false && <div className="num">{t('ib_est', { i: fmtNum(p.estInputTokens), c: cost })}</div>}
    </div>
  );
}
