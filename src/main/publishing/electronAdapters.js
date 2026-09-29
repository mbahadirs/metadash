import fsp from 'node:fs/promises';
import { publishError } from './errors.js';

/**
 * Electron-backed helpers for the worker, loaded lazily so the publishing modules stay importable under
 * ELECTRON_RUN_AS_NODE (tests inject fakes instead).
 */
async function electron() {
  const mod = await import('electron');
  return typeof mod.default === 'object' && mod.default ? { ...mod.default, ...mod } : mod;
}

/** PNG/WebP/large JPEG → JPEG (q=90, ≤ maxWidth) for Instagram. */
export async function electronConvertImage({ filePath, outPath, maxWidth, quality = 90 }) {
  const { nativeImage } = await electron();
  if (!nativeImage?.createFromPath) throw publishError('pub_image_convert_unavailable');
  let img = nativeImage.createFromPath(filePath);
  if (img.isEmpty()) throw publishError('pub_image_convert_failed', {}, { kind: 'media', code: 'image_convert_failed' });
  if (maxWidth && img.getSize().width > maxWidth) img = img.resize({ width: maxWidth, quality: 'best' });
  await fsp.writeFile(outPath, img.toJPEG(quality));
  return outPath;
}

/** powerSaveBlocker while a publish is in flight ('prevent-app-suspension'). */
export function electronKeepAwake() {
  let blocker = null;
  electron().then((e) => { blocker = e.powerSaveBlocker ?? null; }).catch(() => {});
  return {
    start: () => (blocker ? blocker.start('prevent-app-suspension') : null),
    stop: (id) => { if (blocker && id != null && blocker.isStarted(id)) blocker.stop(id); },
  };
}
