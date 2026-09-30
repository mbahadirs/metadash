import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useCli } from '@/hooks/useCli';
import { Section, Loading, CopyButton } from '@/components/ui';

/** How the packaged app is started in command-line mode on each OS (default install locations). */
const INVOCATIONS: { os: 'mac' | 'win' | 'linux'; label: string; command: string }[] = [
  { os: 'mac', label: 'macOS', command: '/Applications/MetaDash.app/Contents/MacOS/MetaDash --cli' },
  { os: 'win', label: 'Windows', command: '"%LOCALAPPDATA%\\Programs\\MetaDash\\MetaDash.exe" --cli' },
  { os: 'linux', label: 'Linux (deb)', command: '/opt/MetaDash/metadash --cli' },
  { os: 'linux', label: 'Linux (AppImage)', command: './MetaDash-<version>-linux-x86_64.AppImage --cli' },
];

const EXAMPLES: { key: 'cli_ex_status' | 'cli_ex_sync' | 'cli_ex_report' | 'cli_ex_export'; args: string }[] = [
  { key: 'cli_ex_status', args: 'status' },
  { key: 'cli_ex_sync', args: 'sync --scope full' },
  { key: 'cli_ex_report', args: 'report --template monthly --client "Acme" --period last_month --out ~/Reports/{account}-{date}.pdf' },
  { key: 'cli_ex_export', args: 'export xlsx --query accounts,media --out ~/Reports/metadash-{date}.xlsx' },
];

const osOf = (platform: string | undefined) => (platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux');

/** Settings → Command-line tool: install the `metadash` shim, per-OS invocation, examples (docs/cli.md). */
export function CliSection() {
  const t = useT();
  const { status, busy, error, install, uninstall } = useCli();
  const [dir, setDir] = useState('');
  const s = status.data;
  const os = osOf(s?.platform);
  const prefix = s?.installed && s.onPath ? 'metadash' : (s?.command ?? 'metadash');

  return (
    <Section title={t('cli_section')}>
      <div className="text-xs text-ink-2 mb-3">{t('cli_intro')}</div>
      {status.isLoading || !s ? <Loading /> : (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm">
              {s.installed
                ? <>{t('cli_installed_at')} <code className="num">{s.shimPath}</code></>
                : t('cli_not_installed')}
            </div>
            {s.installed && !s.onPath && <div className="text-xs text-warn">{t(os === 'win' ? 'cli_not_on_path_win' : 'cli_not_on_path')}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-sm" disabled={busy} onClick={() => install()}>{s.installed ? t('cli_reinstall') : t('cli_install')}</button>
              {s.installed && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => uninstall()}>{t('cli_uninstall')}</button>}
            </div>
            <div className="text-xs text-ink-2">{t(os === 'mac' ? 'cli_install_hint_mac' : os === 'win' ? 'cli_install_hint_win' : 'cli_install_hint_linux')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input w-80" placeholder={t('cli_custom_dir_placeholder')} value={dir} onChange={(e) => setDir(e.target.value)} />
              <button className="btn btn-sm" disabled={busy || !dir.trim()} onClick={() => install(dir.trim())}>{t('cli_install_here')}</button>
            </div>
            {error && <div className="text-xs text-neg">{error}</div>}
          </div>

          <div className="border-t border-line pt-3 space-y-2">
            <div className="font-medium text-sm">{t('cli_without_install')}</div>
            <div className="text-xs text-ink-2">{t('cli_without_install_hint')}</div>
            <table className="text-xs w-full">
              <tbody>
                {INVOCATIONS.map((i) => (
                  <tr key={i.label} className={i.os === os ? 'font-medium' : 'text-ink-2'}>
                    <td className="py-1 pr-3 whitespace-nowrap align-top">{i.label}</td>
                    <td className="py-1"><code className="break-all">{i.command} &lt;command&gt;</code></td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1 pr-3 whitespace-nowrap align-top">{t('cli_this_install')}</td>
                  <td className="py-1"><code className="break-all">{s.installed ? s.command : `${s.command} <command>`}</code></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="border-t border-line pt-3 space-y-2">
            <div className="font-medium text-sm">{t('cli_examples')}</div>
            {EXAMPLES.map((ex) => {
              const cmd = `${prefix} ${ex.args}`;
              return (
                <div key={ex.key} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-ink-2">{t(ex.key)}</div>
                    <code className="text-xs break-all">{cmd}</code>
                  </div>
                  <CopyButton text={cmd} />
                </div>
              );
            })}
            <div className="text-xs text-ink-2">{t('cli_json_hint')}</div>
            <div className="text-xs text-ink-2">{t('cli_schedule_hint')}</div>
            {os === 'win' && <div className="text-xs text-ink-2">{t('cli_windows_output_hint')}</div>}
            <div className="text-xs text-ink-2">{t('cli_exit_codes')}</div>
          </div>
        </div>
      )}
    </Section>
  );
}
