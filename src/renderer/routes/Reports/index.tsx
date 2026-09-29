import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAccounts, useTags, useDigest, useSettings } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT, type Key } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtNum, fmtPct, fmtCompact, fmtDateTime, isoDate, daysAgo } from '@/lib/format';
import { Section, Toggle, Loading, Avatar, TagChip } from '@/components/ui';
import { PostThumb } from '@/components/PostThumb';
import { ExcelButton } from '@/components/ExcelButton';
import { AiCommentaryButton } from './AiCommentaryButton';

type Template = 'monthly' | 'weekly_client' | 'custom' | 'portfolio' | 'campaign' | 'weekly' | 'basket';
type PeriodPreset = 'topbar' | 'today' | 'yesterday' | 7 | 30 | 28 | 'this_month' | 'last_month' | 'custom';
interface Preset { name: string; template: Template; igIds: string[]; tagIds: number[]; sections: Record<string, boolean>; lang: 'tr' | 'en'; coverTitle: string; commentary: string; periodPreset: PeriodPreset; from?: string; to?: string }
interface HistoryEntry { template: Template; filePath: string; kind: 'html' | 'pdf'; from: string; to: string; igIds: string[]; at: number }

const TEMPLATES: Template[] = ['monthly', 'weekly_client', 'custom', 'portfolio', 'campaign', 'weekly', 'basket'];
const ACCOUNT_TEMPLATES: Template[] = ['monthly', 'weekly_client', 'custom', 'campaign'];

function monthRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: isoDate(first), to: isoDate(last) };
}

export function ReportsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const uiLang = useAppStore((s) => s.lang);
  const { period, basket, clearBasket, tagFilter } = useAppStore();
  const accounts = useAccounts();
  const tags = useTags();
  const settings = useSettings();
  const [template, setTemplate] = useState<Template>(params.get('igId') ? 'monthly' : 'portfolio');
  const [igIds, setIgIds] = useState<string[]>(params.get('igId') ? [params.get('igId')!] : []);
  const [tagIds, setTagIds] = useState<number[]>(tagFilter);
  const [search, setSearch] = useState('');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('topbar');
  const [customFrom, setCustomFrom] = useState(period.from);
  const [customTo, setCustomTo] = useState(period.to);
  const [coverTitle, setCoverTitle] = useState('');
  const [logo, setLogo] = useState<{ name: string; dataUrl: string } | null>(null);
  const [lang, setLang] = useState<'tr' | 'en'>(uiLang);
  const [commentary, setCommentary] = useState('');
  const [sectionDefs, setSectionDefs] = useState<Record<string, string[]>>({});
  const [sections, setSections] = useState<Record<string, boolean>>({});
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ files?: string[]; error?: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewTimer = useRef<number | null>(null);
  const digest = useDigest(period.to);

  useEffect(() => {
    call<Record<string, string[]>>(api.export.sections()).then(setSectionDefs).catch(() => {});
    call<HistoryEntry[]>(api.export.history()).then(setHistory).catch(() => {});
  }, []);
  useEffect(() => {
    const saved = (settings.data as { 'ui.reportPresets'?: Preset[] } | undefined)?.['ui.reportPresets'];
    if (saved) setPresets(saved);
  }, [settings.data]);
  useEffect(() => {
    if (template === 'weekly_client' && periodPreset === 'topbar') setPeriodPreset(7);
    if (template === 'custom' && periodPreset === 'topbar') setPeriodPreset('custom');
  }, [template]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsAccount = ACCOUNT_TEMPLATES.includes(template);
  const single = template === 'campaign';
  const range = useMemo(() => {
    if (periodPreset === 'topbar') return { from: period.from, to: period.to };
    if (periodPreset === 'today') return { from: isoDate(new Date()), to: isoDate(new Date()) };
    if (periodPreset === 'yesterday') return { from: daysAgo(1), to: daysAgo(1) };
    if (periodPreset === 7) return { from: daysAgo(6), to: isoDate(new Date()) };
    if (periodPreset === 30 || periodPreset === 28) return { from: daysAgo(29), to: isoDate(new Date()) };
    if (periodPreset === 'this_month') return monthRange(0);
    if (periodPreset === 'last_month') return monthRange(-1);
    return { from: customFrom, to: customTo };
  }, [periodPreset, period, customFrom, customTo]);
  const available = sectionDefs[template] ?? [];
  const buildParams = () => ({ igIds: needsAccount ? igIds : undefined, igId: needsAccount ? igIds[0] : undefined, from: range.from, to: range.to, weekOf: range.to, tagIds, coverTitle: coverTitle || undefined, logoDataUrl: logo?.dataUrl, sections, basket, lang, commentary });
  const ready = (!needsAccount || igIds.length > 0) && range.from <= range.to && (template !== 'basket' || basket.length > 0);

  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(async () => {
      setPreviewBusy(true);
      try { setPreview(await call<string>(api.export.preview({ template, params: buildParams() }))); } catch (e) { setPreview(`<p style="color:#E5605F;font-family:sans-serif">${(e as Error).message}</p>`); } finally { setPreviewBusy(false); }
    }, 450);
    return () => { if (previewTimer.current) window.clearTimeout(previewTimer.current); };
  }, [template, igIds, tagIds, coverTitle, logo, sections, basket, range.from, range.to, lang, commentary, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const runXlsx = async () => {
    setBusy('xlsx'); setResult(null);
    try {
      const res = await call<{ filePath?: string; canceled?: boolean }>(api.export.xlsxReport({ template, params: buildParams() }));
      if (!res.canceled && res.filePath) setResult({ files: [res.filePath] });
      setHistory(await call<HistoryEntry[]>(api.export.history()));
    } catch (e) { setResult({ error: (e as Error).message }); } finally { setBusy(null); }
  };
  const run = async (kinds: ('html' | 'pdf')[]) => {
    setBusy(kinds.join('+'));
    setResult(null);
    const files: string[] = [];
    try {
      for (const kind of kinds) {
        const res = await call<{ filePath?: string; canceled?: boolean }>(kind === 'html' ? api.export.html({ template, params: buildParams() }) : api.export.pdf({ template, params: buildParams() }));
        if (res.canceled) break;
        if (res.filePath) files.push(res.filePath);
      }
      if (files.length) setResult({ files });
      setHistory(await call<HistoryEntry[]>(api.export.history()));
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const savePreset = async () => {
    const name = presetName.trim() || `${t(`tpl_${template}` as Key)} · ${new Date().toLocaleDateString()}`;
    const next = [...presets.filter((p) => p.name !== name), { name, template, igIds, tagIds, sections, lang, coverTitle, commentary, periodPreset, from: customFrom, to: customTo }];
    await call(api.settings.set('ui.reportPresets', next));
    setPresets(next);
    setPresetName('');
    qc.invalidateQueries({ queryKey: ['settings'] });
  };
  const loadPreset = (p: Preset) => {
    setTemplate(p.template); setIgIds(p.igIds); setTagIds(p.tagIds); setSections(p.sections); setLang(p.lang); setCoverTitle(p.coverTitle); setCommentary(p.commentary); setPeriodPreset(p.periodPreset);
    if (p.from) setCustomFrom(p.from); if (p.to) setCustomTo(p.to);
  };
  const deletePreset = async (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    await call(api.settings.set('ui.reportPresets', next));
    setPresets(next);
  };

  const clients = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of accounts.data ?? []) { const c = a.clientName?.trim(); if (c) m.set(c, [...(m.get(c) ?? []), a.igId]); }
    return [...m.entries()].filter(([, ids]) => ids.length > 0).sort((a, b) => a[0].localeCompare(b[0]));
  }, [accounts.data]);
  const list = useMemo(() => (accounts.data ?? []).filter((a) => !search || a.username.includes(search.toLowerCase()) || (a.clientName ?? '').toLowerCase().includes(search.toLowerCase())), [accounts.data, search]);
  const toggleAccount = (id: string) => setIgIds(single ? [id] : igIds.includes(id) ? igIds.filter((x) => x !== id) : [...igIds, id]);

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 xl:col-span-5 space-y-5">
        <Section title={t('template')}>
          <div className="grid grid-cols-2 gap-2">{TEMPLATES.map((tp) => (
            <button key={tp} className={`text-left p-3 rounded border ${template === tp ? 'border-accent' : 'border-line hover:bg-surface-2'}`} style={template === tp ? { background: 'var(--accent-soft)' } : undefined} onClick={() => setTemplate(tp)}>
              <div className="font-medium text-sm">{t(`tpl_${tp}` as Key)}</div><div className="text-xs text-ink-2">{t(`tpl_${tp}_hint` as Key)}</div>
            </button>
          ))}</div>
        </Section>

        <Section title={t('report_period')}>
          <div className="flex flex-wrap gap-1 mb-3">
            {([['topbar', t('use_topbar')], ['today', t('today')], ['yesterday', t('yesterday')], [7, t('last7')], [30, t('last30')], ['this_month', t('this_month')], ['last_month', t('last_month')], ['custom', t('custom')]] as [PeriodPreset, string][]).map(([k, label]) => <button key={String(k)} className={`chip ${periodPreset === k ? 'active' : ''}`} onClick={() => setPeriodPreset(k)}>{label}</button>)}
          </div>
          <div className="flex items-end gap-3">
            <label className="block text-xs text-ink-2"><div className="mb-1">{t('from')}</div><input type="date" className="input w-40" value={periodPreset === 'custom' ? customFrom : range.from} disabled={periodPreset !== 'custom'} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label className="block text-xs text-ink-2"><div className="mb-1">{t('to')}</div><input type="date" className="input w-40" value={periodPreset === 'custom' ? customTo : range.to} disabled={periodPreset !== 'custom'} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} /></label>
            <div className="text-xs text-ink-2 pb-2 num">{range.from} – {range.to}</div>
          </div>
        </Section>

        {needsAccount ? (
          <Section title={`${t('accounts')} · ${t('selected_accounts', { n: igIds.length })}`} right={!single && clients.length > 0 && (
            <select className="input h-7 text-xs w-44" value="" onChange={(e) => { const c = clients.find((x) => x[0] === e.target.value); if (c) setIgIds(c[1]); }}><option value="">{t('select_client')}…</option>{clients.map(([c, ids]) => <option key={c} value={c}>{c} ({ids.length})</option>)}</select>
          )}>
            <input className="input mb-2" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-56 overflow-auto -mx-2">{list.map((a) => { const on = igIds.includes(a.igId); return (
              <button key={a.igId} className={`w-full flex items-center gap-2 px-2 h-8 text-left hover:bg-surface-2 ${on ? 'bg-surface-2' : ''}`} onClick={() => toggleAccount(a.igId)}>
                <input type={single ? 'radio' : 'checkbox'} readOnly checked={on} className="pointer-events-none" /><Avatar username={a.username} url={a.profilePicUrl} color={a.color} size={18} /><span className="truncate">@{a.username}</span><span className="text-xs text-ink-2 truncate">{a.clientName}</span>
              </button>
            ); })}</div>
            {!single && igIds.length > 0 && <button className="btn btn-ghost btn-sm mt-1" onClick={() => setIgIds([])}>{t('clear')}</button>}
          </Section>
        ) : template === 'basket' ? (
          <Section title={`${t('report_basket')} · ${basket.length}`}>{basket.length ? <div className="text-xs text-ink-2">{t('basket_usage')}</div> : <div className="text-sm text-warn">{t('basket_empty')}</div>}</Section>
        ) : (tags.data?.length ?? 0) > 0 && (
          <Section title={t('tags')}><div className="flex flex-wrap gap-1">{(tags.data ?? []).map((tg) => <TagChip key={tg.id} name={tg.name} color={tg.color} active={tagIds.includes(tg.id)} onClick={() => setTagIds(tagIds.includes(tg.id) ? tagIds.filter((x) => x !== tg.id) : [...tagIds, tg.id])} />)}</div></Section>
        )}

        <Section title={t('reports')}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><div className="text-xs text-ink-2 mb-1">{t('cover_title')}</div><input className="input" value={coverTitle} onChange={(e) => setCoverTitle(e.target.value)} placeholder={t(`tpl_${template}` as Key)} /></label>
              <div><div className="text-xs text-ink-2 mb-1">{t('report_lang')}</div><div className="flex gap-1 h-8 items-center"><button className={`chip ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>English</button><button className={`chip ${lang === 'tr' ? 'active' : ''}`} onClick={() => setLang('tr')}>Türkçe</button></div></div>
            </div>
            <div className="flex items-center gap-3"><button className="btn btn-sm" onClick={async () => setLogo(await call(api.export.pickLogo()))}>{t('upload_logo')}</button>{logo && <><img src={logo.dataUrl} alt="" className="h-7" /><span className="text-xs text-ink-2">{logo.name}</span><button className="btn btn-ghost btn-sm" onClick={() => setLogo(null)}>✕</button></>}</div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1"><label htmlFor="report-commentary" className="text-xs text-ink-2 flex-none">{t('commentary')}</label><AiCommentaryButton getParams={() => ({ template, igIds: needsAccount ? igIds : undefined, igId: needsAccount ? igIds[0] : undefined, from: range.from, to: range.to, weekOf: range.to, tagIds, basket, lang })} current={commentary} onText={setCommentary} disabled={!ready} /></div>
              <textarea id="report-commentary" className="input" rows={commentary.length > 300 ? 10 : 4} value={commentary} onChange={(e) => setCommentary(e.target.value)} placeholder={t('commentary_placeholder')} />
            </div>
            <div><div className="text-xs text-ink-2 mb-2">{t('sections')}</div><div className="grid grid-cols-2 gap-1.5">{available.map((s) => <Toggle key={s} checked={sections[s] !== false} onChange={(v) => setSections({ ...sections, [s]: v })} label={t(`sec_${s}` as Key)} />)}</div></div>
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-line">
              <button className="btn btn-primary" disabled={busy !== null || !ready} onClick={() => run(['html'])}>{busy === 'html' ? t('loading') : t('export_html')}</button>
              <button className="btn" disabled={busy !== null || !ready} onClick={() => run(['pdf'])}>{busy === 'pdf' ? t('loading') : t('export_pdf')}</button>
              <button className="btn" disabled={busy !== null || !ready} onClick={() => run(['html', 'pdf'])}>{busy === 'html+pdf' ? t('loading') : t('export_both')}</button>
              <button className="btn" disabled={busy !== null || !ready} onClick={runXlsx} title={t('excel_hint')}>{busy === 'xlsx' ? t('loading') : t('export_xlsx')}</button>
              {result?.files && <span className="text-xs text-ink-2">{t('saved_to')} {result.files.map((f) => <button key={f} className="btn btn-ghost btn-sm" onClick={() => api.system.revealFile(f)}>{f.split('/').pop()}</button>)}</span>}
              {result?.error && <span className="text-xs text-neg">{result.error}</span>}
            </div>
          </div>
        </Section>

        <Section title={`${t('presets')} · ${presets.length}`}>
          <div className="space-y-1 mb-3">{presets.map((p) => (
            <div key={p.name} className="flex items-center justify-between gap-2 h-8 text-sm"><span className="truncate">{p.name} <span className="text-ink-2 text-xs">{t(`tpl_${p.template}` as Key)} · {p.igIds.length ? t('selected_accounts', { n: p.igIds.length }) : t('all')}</span></span><span className="flex gap-1"><button className="btn btn-sm" onClick={() => loadPreset(p)}>{t('load')}</button><button className="btn btn-ghost btn-sm text-ink-2" onClick={() => deletePreset(p.name)}>✕</button></span></div>
          ))}{!presets.length && <div className="text-xs text-ink-2">{t('none')}</div>}</div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); savePreset(); }}><input className="input" placeholder={t('preset_name')} value={presetName} onChange={(e) => setPresetName(e.target.value)} /><button className="btn" type="submit">{t('save_preset')}</button></form>
        </Section>
      </div>

      <div className="col-span-12 xl:col-span-7 space-y-5">
        <Section title={`${t('preview')} · ${t(`tpl_${template}` as Key)}`} right={<span className="text-xs text-ink-2 num">{previewBusy ? t('loading') : preview ? `${Math.round(preview.length / 1024)} KB` : ''}</span>}>
          {preview ? <iframe title="preview" sandbox="" srcDoc={preview} className="w-full rounded border border-line bg-surface-0" style={{ height: 900 }} /> : <div className="text-ink-2 text-sm py-10 text-center">{needsAccount && !igIds.length ? t('select_accounts').replace(' (2–6)', '') : template === 'basket' && !basket.length ? t('basket_empty') : t('loading')}</div>}
        </Section>
        <Section title={`${t('report_history')} · ${history.length}`} right={history.length > 0 && <><ExcelButton name="report-history" getData={() => ({ name: t('report_history'), columns: [{ key: 'at', label: t('date'), type: 'datetime' }, { key: 'template', label: t('template'), type: 'text' }, { key: 'kind', label: t('type'), type: 'text' }, { key: 'from', label: t('from'), type: 'date' }, { key: 'to', label: t('to'), type: 'date' }, { key: 'filePath', label: t('file'), type: 'text' }], rows: history })} /><button className="btn btn-ghost btn-sm" onClick={async () => setHistory(await call(api.export.clearHistory()))}>{t('clear')}</button></>}>
          {history.length ? <div className="max-h-64 overflow-auto -m-4"><table className="table"><thead><tr><th>{t('date')}</th><th>{t('template')}</th><th>{t('report_period')}</th><th>{t('accounts')}</th><th></th></tr></thead>
            <tbody>{history.map((h, i) => <tr key={i}><td className="text-ink-2">{fmtDateTime(h.at)}</td><td>{t(`tpl_${h.template}` as Key)} <span className="badge badge-muted">{h.kind}</span></td><td className="num text-ink-2">{h.from} – {h.to}</td><td className="text-ink-2">{h.igIds?.length ? (accounts.data ?? []).filter((a) => h.igIds.includes(a.igId)).map((a) => '@' + a.username).join(', ') : t('all')}</td><td><button className="btn btn-ghost btn-sm" onClick={() => api.system.revealFile(h.filePath)}>{t('reveal')}</button></td></tr>)}</tbody></table></div> : <div className="text-xs text-ink-2">{t('none')}</div>}
        </Section>
        <div className="grid grid-cols-2 gap-5">
          <Section title={`${t('weekly_digest')} · ${digest.data?.from ?? ''} – ${digest.data?.to ?? ''}`}>
            {digest.isLoading ? <Loading /> : digest.data && (
              <div className="space-y-3"><p className="text-sm leading-relaxed m-0">{digest.data.text}</p>
                <div className="grid grid-cols-3 gap-2 text-xs num"><div className="bg-surface-2 rounded p-2"><div className="text-ink-2">{t('reach')}</div><div className="text-base font-semibold">{fmtCompact(digest.data.kpis.totalReach.value)}</div></div><div className="bg-surface-2 rounded p-2"><div className="text-ink-2">{t('net_change')}</div><div className="text-base font-semibold">{fmtNum(digest.data.kpis.netFollowers.value)}</div></div><div className="bg-surface-2 rounded p-2"><div className="text-ink-2">{t('er')}</div><div className="text-base font-semibold">{fmtPct(digest.data.kpis.avgEr.value, 2)}</div></div></div>
                <div className="space-y-1">{digest.data.topPosts.map((p) => <div key={p.mediaId} className="flex items-center gap-2 text-xs"><PostThumb mediaId={p.mediaId} thumbnailPath={p.thumbnailPath} mediaType={p.mediaType} mediaProductType={p.mediaProductType} size={22} /><span className="text-ink-2">@{p.username}</span><span className="truncate flex-1">{p.caption}</span><span className="num">{fmtCompact(p.reach)}</span></div>)}</div>
              </div>
            )}
          </Section>
          <Section title={`${t('report_basket')} · ${basket.length}`} right={basket.length > 0 && <button className="btn btn-ghost btn-sm" onClick={clearBasket}>{t('clear')}</button>}>
            {basket.length === 0 ? <div className="text-ink-2 text-sm">{t('basket_empty')}</div> : <div className="space-y-2"><div className="text-xs text-ink-2">{t('basket_usage')}</div><div className="flex gap-2"><button className="btn btn-sm" onClick={() => setTemplate('basket')}>{t('tpl_basket')}</button><a className="btn btn-sm" href="#/presentation">{t('nav_presentation')}</a></div><div className="flex flex-wrap gap-1">{basket.map((id) => <span key={id} className="badge badge-muted num">{id}</span>)}</div></div>}
          </Section>
        </div>
      </div>
    </div>
  );
}
