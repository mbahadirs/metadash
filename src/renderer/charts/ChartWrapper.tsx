import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useAppStore } from '@/store/app';

/** Wraps every chart with data-chart-id so it can be exported to PNG. */
export function ChartWrapper({ id, title, right, children, height = 260 }: { id: string; title?: ReactNode; right?: ReactNode; children: ReactNode; height?: number }) {
  const t = useT();
  const theme = useAppStore((s) => s.theme);
  return (
    <div className="panel">
      {(title || right) && (
        <div className="flex items-center justify-between px-4 h-11 border-b border-line">
          <div className="font-medium">{title}</div>
          <div className="flex items-center gap-2">
            {right}
            <button className="btn btn-ghost btn-sm text-ink-2" title={t('export_chart')} onClick={() => api.export.pngChart({ chartId: id, background: theme === 'light' ? '#FFFFFF' : '#10131A', name: id })}>{t('export_png')}</button>
          </div>
        </div>
      )}
      <div data-chart-id={id} className="p-3" style={{ height }}>{children}</div>
    </div>
  );
}
