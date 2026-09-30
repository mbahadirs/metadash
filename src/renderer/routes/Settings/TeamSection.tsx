import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import type { TeamState, TeamMember, NoteV2, Role } from '@/lib/types';
import { Section, Toggle, Loading } from '@/components/ui';
import { RoleGate } from '@/components/RoleGate';
import { PresentToClientButton } from '@/components/ClientViewBanner';
import { MentionsBadge } from '@/components/NotesThread';
import { useSession, refreshSession } from '@/hooks/useSession';
import { useTeamState, useTeamAction, useMentions, sessionApi } from '@/hooks/useTeam';

/**
 * Settings → Team: identity, create (publish) / join (subscribe) a shared-folder team, status and members, own role,
 * "Present to client" and unseen mentions. docs/team.md explains the model and the guardrail (not security) caveat.
 */
export function TeamSection() {
  const t = useT();
  const team = useTeamState();
  const s = team.data;
  return (
    <Section title={<span className="flex items-center gap-2">{t('team_section_title')}<MentionsBadge /></span>}>
      <div className="space-y-5 text-sm">
        <div className="text-xs text-ink-2">{t('team_guardrail_note')}</div>
        {!s ? <Loading /> : (
          <>
            <IdentityForm me={s.me} />
            {s.mode === 'none' ? <SetupPanels hasIdentity={!!s.me} /> : <TeamStatus s={s} />}
            <RolePanel />
            <MentionsPanel />
          </>
        )}
      </div>
    </Section>
  );
}

function ErrorLine({ error }: { error: Error | null | undefined }) {
  return error ? <div className="text-neg text-xs">{error.message}</div> : null;
}

function IdentityForm({ me }: { me: TeamMember | null }) {
  const t = useT();
  const [name, setName] = useState(me?.name ?? '');
  const [handle, setHandle] = useState(me?.handle ?? '');
  useEffect(() => { setName(me?.name ?? ''); setHandle(me?.handle ?? ''); }, [me?.name, me?.handle]);
  const save = useTeamAction<{ name: string; handle: string }>((p) => api.team.setIdentity(p));
  return (
    <div className="space-y-2">
      <div className="font-medium">{t('team_identity')}</div>
      <div className="text-xs text-ink-2">{t('team_identity_hint')}</div>
      <form className="flex flex-wrap gap-2 items-center" onSubmit={(e) => { e.preventDefault(); save.mutate({ name, handle }); }}>
        <input className="input w-48" placeholder={t('team_name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <input className="input w-40" placeholder={t('team_handle')} value={handle} onChange={(e) => setHandle(e.target.value.replace(/\s/g, ''))} maxLength={33} />
        <button className="btn" type="submit" disabled={!name.trim() || !handle.trim() || save.isPending}>{t('team_save')}</button>
        {save.isSuccess && <span className="text-pos text-xs">{t('team_saved')}</span>}
      </form>
      <ErrorLine error={save.error} />
    </div>
  );
}

function FolderPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const pick = async () => {
    const res = await call<{ folder?: string; canceled?: boolean }>(api.team.pickFolder()).catch(() => null);
    if (res?.folder) onChange(res.folder);
  };
  return (
    <div className="flex gap-2 items-center">
      <input className="input flex-1" readOnly placeholder={t('team_folder')} value={value} title={value} />
      <button type="button" className="btn" onClick={() => void pick()}>{t('team_pick_folder')}</button>
    </div>
  );
}

function SetupPanels({ hasIdentity }: { hasIdentity: boolean }) {
  const t = useT();
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [encrypt, setEncrypt] = useState(true);
  const [pass, setPass] = useState('');
  const [joinFolder, setJoinFolder] = useState('');
  const [joinPass, setJoinPass] = useState('');
  const create = useTeamAction<{ folder: string; name: string; encrypt: boolean; passphrase: string | null }>((p) => api.team.create(p));
  const join = useTeamAction<{ folder: string; passphrase: string | null }>((p) => api.team.join(p));
  return (
    <div className="space-y-4">
      <div className="text-ink-2">{t('team_mode_none')}</div>
      {!hasIdentity && <div className="text-warn text-xs">{t('team_identity_first')}</div>}
      <RoleGate allow={['admin']} writable>
        <div className="panel p-3 space-y-2">
          <div className="font-medium">{t('team_create_title')}</div>
          <div className="text-xs text-ink-2">{t('team_create_hint')}</div>
          <FolderPicker value={folder} onChange={setFolder} />
          <input className="input w-full" placeholder={t('team_team_name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Toggle checked={encrypt} onChange={setEncrypt} label={t('team_encrypt')} />
          {encrypt && <><input className="input w-full" type="password" autoComplete="new-password" placeholder={t('team_passphrase')} value={pass} onChange={(e) => setPass(e.target.value)} /><div className="text-xs text-ink-2">{t('team_passphrase_hint')}</div></>}
          <button className="btn btn-primary" disabled={!hasIdentity || !folder || !name.trim() || (encrypt && pass.length < 8) || create.isPending}
            onClick={() => create.mutate({ folder, name, encrypt, passphrase: encrypt ? pass : null }, { onSuccess: () => setPass('') })}>
            {create.isPending ? t('team_busy') : t('team_create')}
          </button>
          <ErrorLine error={create.error} />
        </div>
      </RoleGate>
      <div className="panel p-3 space-y-2">
        <div className="font-medium">{t('team_join_title')}</div>
        <div className="text-xs text-ink-2">{t('team_join_hint')}</div>
        <FolderPicker value={joinFolder} onChange={setJoinFolder} />
        <input className="input w-full" type="password" autoComplete="off" placeholder={t('team_passphrase_optional')} value={joinPass} onChange={(e) => setJoinPass(e.target.value)} />
        <button className="btn" disabled={!hasIdentity || !joinFolder || join.isPending} onClick={() => join.mutate({ folder: joinFolder, passphrase: joinPass || null }, { onSuccess: () => setJoinPass('') })}>
          {join.isPending ? t('team_busy') : t('team_join')}
        </button>
        <ErrorLine error={join.error} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="text-ink-2">{label}</span><span className="text-right truncate">{value}</span></div>;
}

function TeamStatus({ s }: { s: TeamState }) {
  const t = useT();
  const [keepCopy, setKeepCopy] = useState(false);
  const publish = useTeamAction<void>(() => api.team.publishNow());
  const pull = useTeamAction<void>(() => api.team.pullNow());
  const leave = useTeamAction<{ keepCopy: boolean }>((p) => api.team.leave(p));
  const roleLabel = (r: Role) => t(r === 'admin' ? 'team_role_admin' : r === 'client' ? 'team_role_client' : 'team_role_analyst');
  return (
    <div className="space-y-3">
      <div className="panel p-3 space-y-1.5">
        <Row label={t('team_team_name')} value={<b>{s.name}</b>} />
        <Row label={t('team_status')} value={s.mode === 'publisher' ? t('team_mode_publisher') : t('team_mode_subscriber')} />
        <Row label={t('team_folder')} value={<span title={s.folder ?? ''}>{s.folder}</span>} />
        <Row label={t('team_encryption')} value={s.encrypted ? t('team_encrypted') : t('team_not_encrypted')} />
        {s.mode === 'publisher' && <Row label={t('team_last_publish')} value={fmtRelative(s.lastPublishAt)} />}
        <Row label={t('team_last_pull')} value={fmtRelative(s.lastPullAt)} />
        {s.snapshotAt && <Row label={t('team_snapshot_at')} value={`${fmtDateTime(s.snapshotAt)}${s.publisher ? ` · ${s.publisher}` : ''}`} />}
        {s.error && <Row label={t('team_error')} value={<span className="text-neg">{s.error}</span>} />}
      </div>
      <div className="flex flex-wrap gap-2">
        {s.mode === 'publisher' && <button className="btn" disabled={publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? t('team_busy') : t('team_publish_now')}</button>}
        <button className="btn" disabled={pull.isPending} onClick={() => pull.mutate()}>{pull.isPending ? t('team_busy') : t('team_pull_now')}</button>
      </div>
      <ErrorLine error={publish.error ?? pull.error} />
      <div>
        <div className="font-medium mb-1">{t('team_members')}</div>
        <table className="table">
          <thead><tr><th>{t('team_name')}</th><th>{t('team_handle')}</th><th>{t('team_role')}</th></tr></thead>
          <tbody>
            {s.members.map((m) => <tr key={m.id}><td>{m.name}{m.isSelf ? <span className="text-ink-2"> ({t('team_you')})</span> : null}</td><td>@{m.handle}</td><td>{roleLabel(m.role)}</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {s.mode === 'subscriber' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} />{t('team_keep_copy')}</label>}
        <button className="btn btn-ghost text-neg" disabled={leave.isPending} onClick={() => { if (window.confirm(t('team_leave_confirm'))) leave.mutate({ keepCopy }); }}>{t('team_leave')}</button>
      </div>
      <ErrorLine error={leave.error} />
    </div>
  );
}

function RolePanel() {
  const t = useT();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const change = async (role: 'admin' | 'analyst') => {
    try { await sessionApi.setRole(role); setError(null); await refreshSession(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="space-y-2">
      <div className="font-medium">{t('team_role')}</div>
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={session.role === 'client' ? 'analyst' : session.role} disabled={session.readOnly || session.role === 'client'} onChange={(e) => void change(e.target.value as 'admin' | 'analyst')}>
          <option value="admin" disabled={session.readOnly}>{t('team_role_admin')}</option>
          <option value="analyst">{t('team_role_analyst')}</option>
        </select>
        <PresentToClientButton />
      </div>
      <div className="text-xs text-ink-2">{session.readOnly ? t('team_role_subscriber_hint') : t('team_role_hint')}</div>
      {error && <div className="text-neg text-xs">{error}</div>}
    </div>
  );
}

function MentionsPanel() {
  const t = useT();
  const mentions = useMentions();
  const seen = useTeamAction<string[]>((uids) => api.notes.markSeen(uids));
  const list: NoteV2[] = mentions.data ?? [];
  return (
    <div className="space-y-2">
      <div className="font-medium">{t('team_mentions')}</div>
      {list.length === 0 ? <div className="text-xs text-ink-2">{t('team_no_mentions')}</div> : (
        <>
          {list.map((n) => (
            <div key={n.uid} className="bg-surface-2 rounded px-3 py-1.5">
              <div className="text-xs text-ink-2"><b className="text-ink-1">{n.author_name ?? t('team_unknown_author')}</b> · {fmtRelative(n.updated_at ?? n.created_at)}</div>
              <div className="whitespace-pre-wrap">{n.body}</div>
            </div>
          ))}
          <button className="btn btn-sm" onClick={() => seen.mutate(list.map((n) => n.uid))}>{t('team_mark_seen')}</button>
        </>
      )}
    </div>
  );
}
