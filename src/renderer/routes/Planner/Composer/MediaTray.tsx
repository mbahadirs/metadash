import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useT } from '@/lib/i18n';
import { Modal, Spinner } from '@/components/ui';
import { fmtNum } from '@/lib/format';
import { plannerApi } from '@/hooks/usePlanner';
import { mediaUrl, type Issue, type PlannerAsset } from '@/lib/types';
import { useToast } from '../Toast';
import { AssetThumb, IssueList } from '../parts';
import { errorText } from '../lib';
import type { ComposerMedia } from './state';

const MAX_PATHS = 50;
const THUMB_WIDTH = 480;
const REORDER_MIME = 'application/x-metadash-asset';

/**
 * Post media: file dialog, drag-and-drop from the OS (preload pathForFile → planner:assets:import), paste (images,
 * planner:assets:importData), reorder (drag or ←/→ buttons), alt text, per-asset issues and a full preview.
 */
export function MediaTray({ media, issues, disabled, onChange }: { media: ComposerMedia[]; issues: Issue[]; disabled: boolean; onChange: (m: ComposerMedia[]) => void }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<PlannerAsset | null>(null);
  const mediaRef = useRef(media);
  mediaRef.current = media;

  const add = (assets: PlannerAsset[]) => {
    const have = new Set(mediaRef.current.map((m) => m.asset.id));
    const fresh = assets.filter((a) => !have.has(a.id));
    if (fresh.length) onChange([...mediaRef.current, ...fresh.map((asset) => ({ asset, altText: '' }))]);
  };
  const run = async (fn: () => Promise<PlannerAsset[]>) => {
    setBusy(true);
    try { add(await fn()); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const pickFiles = () => run(() => plannerApi.importAssets());

  const onDrop = (e: DragEvent) => {
    setOver(false);
    if (disabled || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    const paths = Array.from(e.dataTransfer.files).map((f) => plannerApi.pathForFile(f)).filter(Boolean).slice(0, MAX_PATHS);
    if (!paths.length) { toast(t('pl_drop_unsupported'), 'error'); return; }
    run(() => plannerApi.importAssets(paths));
  };
  const onPaste = (e: ClipboardEvent) => {
    if (disabled) return;
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    run(() => Promise.all(files.map((f) => readDataUrl(f).then((dataUrl) => plannerApi.importData(f.name || 'pasted.png', dataUrl)))));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= media.length || from === to) return;
    const next = [...media];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const setAssetThumb = (asset: PlannerAsset) => onChange(mediaRef.current.map((m) => (m.asset.id === asset.id ? { ...m, asset } : m)));

  return (
    <div
      className={`rounded border border-dashed p-2 ${over ? 'border-accent bg-[var(--accent-soft)]' : 'border-line'}`}
      onDragOver={(e) => { if (!disabled && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <div className="flex flex-wrap gap-2">
        {media.map((m, i) => {
          const own = issues.filter((x) => x.assetId === m.asset.id);
          const worst = own.some((x) => x.level === 'error') ? 'var(--neg)' : own.some((x) => x.level === 'warn') ? 'var(--warn)' : 'var(--line)';
          return (
            <div key={m.asset.id} className="w-[132px] rounded border p-1 space-y-1 bg-surface-1" style={{ borderColor: worst }}
              draggable={!disabled}
              onDragStart={(e) => { e.dataTransfer.setData(REORDER_MIME, String(i)); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(REORDER_MIME)) e.preventDefault(); }}
              onDrop={(e) => { const from = Number(e.dataTransfer.getData(REORDER_MIME)); if (Number.isInteger(from) && e.dataTransfer.types.includes(REORDER_MIME)) { e.preventDefault(); e.stopPropagation(); move(from, i); } }}
            >
              <button type="button" className="block w-full" onClick={() => setPreview(m.asset)} aria-label={`${t('pl_preview_media')} ${i + 1}`}>
                <AssetThumb assetId={m.asset.id} size={122} kind={m.asset.kind} alt={m.altText} />
              </button>
              {m.asset.kind === 'video' && !m.asset.thumbPath && <VideoThumbMaker asset={m.asset} onDone={setAssetThumb} />}
              <div className="text-[10px] text-ink-2 num truncate" title={m.asset.fileName ?? ''}>
                {i + 1}. {m.asset.width && m.asset.height ? `${m.asset.width}×${m.asset.height}` : m.asset.format ?? m.asset.kind}
                {m.asset.durationMs ? ` · ${fmtNum(m.asset.durationMs / 1000, 1)}s` : ''}
              </div>
              <input className="input h-6 text-[11px] px-1" placeholder={t('pl_alt_text')} aria-label={`${t('pl_alt_text')} ${i + 1}`} value={m.altText} disabled={disabled}
                onChange={(e) => onChange(media.map((x) => (x.asset.id === m.asset.id ? { ...x, altText: e.target.value } : x)))} />
              <div className="flex items-center justify-between">
                <button type="button" className="btn btn-ghost btn-sm px-1" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} aria-label={t('pl_move_left')}>←</button>
                {own.length > 0 && <span className="text-[10px]" style={{ color: worst }} title={own.map((x) => x.code).join(', ')}>{t('pl_issues_n', { n: own.length })}</span>}
                <button type="button" className="btn btn-ghost btn-sm px-1" disabled={disabled || i === media.length - 1} onClick={() => move(i, i + 1)} aria-label={t('pl_move_right')}>→</button>
                <button type="button" className="btn btn-ghost btn-sm px-1 text-neg" disabled={disabled} onClick={() => onChange(media.filter((x) => x.asset.id !== m.asset.id))} aria-label={t('pl_remove_media')}>✕</button>
              </div>
            </div>
          );
        })}
        <div className="flex flex-col justify-center gap-1 min-w-[160px] text-xs text-ink-2 p-2">
          <button type="button" className="btn btn-sm" onClick={pickFiles} disabled={disabled || busy}>{busy ? <Spinner size={12} /> : '+'} {t('pl_add_media')}</button>
          <span>{t('pl_media_drop_hint')}</span>
        </div>
      </div>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.fileName ?? t('pl_preview_media')} width={720}>
        {preview && (
          <div className="space-y-3">
            {preview.kind === 'video'
              ? <video src={mediaUrl(preview.id)} controls className="max-h-[60vh] w-full bg-black rounded" />
              : <img src={mediaUrl(preview.id)} alt="" className="max-h-[60vh] mx-auto rounded" />}
            <div className="text-xs text-ink-2 num">
              {[preview.mime, preview.width && preview.height ? `${preview.width}×${preview.height}` : null, preview.bytes ? `${fmtNum(preview.bytes / 1_048_576, 1)} MB` : null,
                preview.durationMs ? `${fmtNum(preview.durationMs / 1000, 1)} s` : null, preview.videoCodec, preview.fps ? `${fmtNum(preview.fps, 0)} fps` : null].filter(Boolean).join(' · ')}
            </div>
            <IssueList issues={issues.filter((x) => x.assetId === preview.id)} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

/**
 * Linux has no native video thumbnailer: draw a frame from mdmedia:// to a canvas and store it with
 * planner:assets:setThumb (the protocol sends CORS headers so the canvas is not tainted).
 */
function VideoThumbMaker({ asset, onDone }: { asset: PlannerAsset; onDone: (a: PlannerAsset) => void }) {
  const tried = useRef(false);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { tried.current = false; }, [asset.id]);
  const capture = async () => {
    const v = ref.current;
    if (!v || tried.current || !v.videoWidth) return;
    tried.current = true;
    try {
      const scale = Math.min(1, THUMB_WIDTH / v.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
      onDone(await plannerApi.setThumb(asset.id, c.toDataURL('image/jpeg', 0.8)));
    } catch (e) {
      console.warn('[planner] video thumbnail failed', e);
    }
  };
  return (
    <video ref={ref} src={mediaUrl(asset.id)} crossOrigin="anonymous" preload="auto" muted playsInline className="hidden"
      onLoadedMetadata={(e) => { const v = e.currentTarget; v.currentTime = Math.min(1, (v.duration || 0) / 3); }}
      onSeeked={capture} aria-hidden />
  );
}
