import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT, type Key } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { Section, Toggle, Loading } from '@/components/ui';
import { useAiStatus, AI_STATUS_KEY, type AiStatus, type AiProvider } from '@/hooks/useAi';
import { AiStudioSettings } from './AiStudioSettings';
import { STUDIO_KEY } from '@/hooks/useStudio';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

/** Opt-in, bring-your-own-key AI assistant settings. Keys are write-only: only "set · …last4" comes back. */
export function AiSection() {
  const t = useT();
  const qc = useQueryClient();
  const status = useAiStatus();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const s = status.data;

  const apply = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      qc.setQueryData(AI_STATUS_KEY, await call<AiStatus>(fn() as never));
      qc.invalidateQueries({ queryKey: [STUDIO_KEY] }); // provider/model changes alter capabilities and pricing
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
  };
  const test = async () => {
    setBusy(true); setMsg(null);
    try { const r = await call<{ model: string }>(api.ai.test()); setMsg({ kind: 'ok', text: t('ai_test_ok', { m: r.model }) }); } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  if (status.isLoading || !s) return <Section title={t('ai_section')}><Loading /></Section>;
  return (
    <Section title={t('ai_section')}>
      <div className="text-xs text-ink-2 mb-3">{t('ai_intro')}</div>
      <div className="space-y-4">
        <Toggle checked={s.enabled} onChange={(v) => apply(() => api.ai.setConfig({ enabled: v }))} label={t('ai_enable')} />
        <div className={`space-y-3 ${s.enabled ? '' : 'opacity-50 pointer-events-none'}`} aria-disabled={!s.enabled}>
          <Row label={t('ai_provider')}>
            <select className="input w-64" value={s.provider} onChange={(e) => apply(() => api.ai.setConfig({ provider: e.target.value }))}>
              {s.providers.map((p) => <option key={p} value={p}>{t(`ai_provider_${p}` as Key)}</option>)}
            </select>
          </Row>
          <Row label={t('ai_model')}><ModelField status={s} onSave={(model) => apply(() => api.ai.setConfig({ model }))} /></Row>
          {s.provider === 'ollama'
            ? <Row label={t('ai_ollama_url')}><TextSetting value={s.ollamaUrl} onSave={(v) => apply(() => api.ai.setConfig({ ollamaUrl: v }))} /></Row>
            : <Row label={t('ai_api_key')}><KeyField provider={s.provider} status={s} onSave={(key) => apply(() => api.ai.setKey(s.provider, key))} /></Row>}
          <div className="flex items-center gap-3">
            <button className="btn btn-sm" disabled={busy || !s.enabled} onClick={test}>{busy ? t('loading') : t('ai_test')}</button>
            {msg && <span className={`text-xs ${msg.kind === 'ok' ? 'text-pos' : 'text-neg'}`}>{msg.text}</span>}
          </div>
          <AiStudioSettings provider={s.provider} enabled={s.enabled} />
        </div>
        <div className="text-xs text-ink-2 border-t border-line pt-3">{t('ai_privacy')}</div>
      </div>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-3"><span className="w-40 text-sm">{label}</span>{children}</div>;
}

function ModelField({ status, onSave }: { status: AiStatus; onSave: (model: string) => void }) {
  const t = useT();
  if (status.provider === 'anthropic') {
    return <select className="input w-64" value={status.model} onChange={(e) => onSave(e.target.value)}>{status.anthropicModels.map((m) => <option key={m} value={m}>{m}</option>)}</select>;
  }
  const def = status.defaultModels[status.provider];
  return <TextSetting value={status.model === def ? '' : status.model} placeholder={def} hint={t('ai_model_hint', { m: def })} onSave={onSave} />;
}

/** Text input that saves on blur / Enter. */
function TextSetting({ value, placeholder, hint, onSave }: { value: string; placeholder?: string; hint?: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft.trim() !== value) onSave(draft.trim()); };
  return (
    <span className="flex items-center gap-2">
      <input className="input w-64" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      {hint && <span className="text-xs text-ink-2">{hint}</span>}
    </span>
  );
}

function KeyField({ provider, status, onSave }: { provider: AiProvider; status: AiStatus; onSave: (key: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  useEffect(() => setDraft(''), [provider]);
  const key = status.keys[provider];
  const save = () => { if (draft.trim()) { onSave(draft.trim()); setDraft(''); } };
  return (
    <span className="flex items-center gap-2">
      <input type="password" autoComplete="off" spellCheck={false} className="input w-64" value={draft} placeholder={t('ai_key_placeholder')} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      <button className="btn btn-sm" disabled={!draft.trim()} onClick={save}>{t('save')}</button>
      <span className={`text-xs ${key?.set ? 'text-pos' : 'text-ink-2'}`}>{key?.set ? t('ai_key_set', { k: key.last4 ?? '' }) : t('ai_key_not_set')}</span>
      {key?.set && <button className="btn btn-ghost btn-sm text-ink-2" onClick={() => onSave('')}>{t('ai_key_remove')}</button>}
    </span>
  );
}
