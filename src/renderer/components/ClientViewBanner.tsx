import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { useSession, refreshSession } from '@/hooks/useSession';
import { sessionApi } from '@/hooks/useTeam';
import { useAccounts } from '@/hooks/queries';
import { Modal } from './ui';

/** Top banner while the client view is active; exiting asks for the PIN. */
export function ClientViewBanner() {
  const t = useT();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (session.role !== 'client') return null;
  const exit = async () => {
    try {
      await sessionApi.exitClientView({ pin });
      setOpen(false); setPin(''); setError(null);
      await refreshSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="bg-accent-soft px-4 py-2 text-sm flex items-center justify-between" style={{ background: 'var(--accent-soft)' }} role="status">
      <span>{t('team_client_banner', { clients: (session.clientScope ?? []).join(', ') })}</span>
      <button className="btn btn-sm" onClick={() => setOpen(true)}>{t('team_exit_client')}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('team_exit_client')} width={360}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void exit(); }}>
          <input className="input" type="password" inputMode="numeric" autoComplete="off" autoFocus placeholder={t('team_pin')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          {error && <div className="text-neg text-xs">{error}</div>}
          <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>{t('team_cancel')}</button><button className="btn btn-primary" type="submit" disabled={pin.length < 4}>{t('team_exit')}</button></div>
        </form>
      </Modal>
    </div>
  );
}

/** "Present to client": pick client names and a PIN, then switch to the client view. */
export function PresentToClientButton() {
  const t = useT();
  const navigate = useNavigate();
  const session = useSession();
  const accounts = useAccounts({ onlyTracked: false });
  const clients = useMemo(() => [...new Set((accounts.data ?? []).map((a) => a.clientName).filter((c): c is string => !!c))].sort(), [accounts.data]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (session.role === 'client') return null;
  const toggle = (c: string) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const start = async () => {
    try {
      await sessionApi.enterClientView({ clientNames: picked, pin });
      setOpen(false); setPin(''); setError(null);
      await refreshSession();
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>{t('team_present')}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('team_present')} width={440}>
        <div className="space-y-3 text-sm">
          <div className="text-ink-2 text-xs">{t('team_present_hint')}</div>
          {clients.length === 0 ? <div className="text-ink-2">{t('team_no_clients')}</div> : (
            <div className="space-y-1 max-h-56 overflow-auto">
              {clients.map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={picked.includes(c)} onChange={() => toggle(c)} />{c}</label>)}
            </div>
          )}
          <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder={t('team_pin')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <div className="text-ink-2 text-xs">{t('team_guardrail_note')}</div>
          {error && <div className="text-neg text-xs">{error}</div>}
          <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setOpen(false)}>{t('team_cancel')}</button><button className="btn btn-primary" disabled={!picked.length || pin.length < 4} onClick={() => void start()}>{t('team_start')}</button></div>
        </div>
      </Modal>
    </>
  );
}
