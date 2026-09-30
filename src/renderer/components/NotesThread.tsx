import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { NoteV2 } from '@/lib/types';
import { useSession } from '@/hooks/useSession';
import { useTeamState, useTeamAction, useMentions } from '@/hooks/useTeam';
import { MentionInput } from './MentionInput';

type Visibility = NoteV2['visibility'];

/**
 * Notes of an account / post / inbox comment with author, time, @mentions and a visibility chip. Replaces the simple
 * notes list. The client view only receives notes marked "Visible to client" and cannot write.
 */
export function NotesThread({ entityType, entityId }: { entityType: 'account' | 'media' | 'comment'; entityId: string }) {
  const t = useT();
  const session = useSession();
  const team = useTeamState();
  const notes = useQuery<NoteV2[]>({ queryKey: ['notes', entityType, entityId], queryFn: () => call(api.notes.list({ entityType, entityId })) });
  const add = useTeamAction<{ entityType: string; entityId: string; body: string; mentions: string[]; visibility: Visibility }>((p) => api.notes.add(p));
  const update = useTeamAction<{ uid: string; body: string; mentions: string[]; visibility: Visibility }>((p) => api.notes.update(p));
  const del = useTeamAction<number>((id) => api.notes.delete(id));
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>('internal');
  const [editing, setEditing] = useState<string | null>(null);
  const canWrite = session.role !== 'client';
  const meId = team.data?.me?.id ?? null;
  const submit = () => {
    if (!body.trim()) return;
    add.mutate({ entityType, entityId, body, mentions, visibility }, { onSuccess: () => { setBody(''); setMentions([]); } });
  };
  const list = notes.data ?? [];
  return (
    <div className="space-y-2">
      {list.length === 0 && <div className="text-xs text-ink-2">{t('team_no_notes')}</div>}
      {list.map((n) => (
        <NoteItem key={n.uid ?? n.id} note={n} editing={editing === n.uid} canEdit={canWrite && (!n.author_id || n.author_id === meId || session.role === 'admin')}
          onEdit={() => setEditing(n.uid)} onCancel={() => setEditing(null)} onDelete={() => del.mutate(n.id)}
          onSave={(p) => update.mutate({ uid: n.uid, ...p }, { onSuccess: () => setEditing(null) })} />
      ))}
      {canWrite && (
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <MentionInput value={body} onChange={setBody} mentions={mentions} onMentionsChange={setMentions} placeholder={t('team_add_note')} onSubmit={submit} />
          <div className="flex items-center justify-between gap-2">
            <VisibilitySelect value={visibility} onChange={setVisibility} />
            <button className="btn btn-sm" type="submit" disabled={!body.trim() || add.isPending}>{t('team_add')}</button>
          </div>
          {(add.error || update.error || del.error) && <div className="text-neg text-xs">{(add.error ?? update.error ?? del.error)?.message}</div>}
        </form>
      )}
    </div>
  );
}

function VisibilitySelect({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const t = useT();
  return (
    <select className="input input-sm w-auto" value={value} onChange={(e) => onChange(e.target.value as Visibility)} aria-label={t('team_visibility')}>
      <option value="internal">{t('team_visibility_internal')}</option>
      <option value="client">{t('team_visibility_client')}</option>
    </select>
  );
}

function NoteItem({ note, editing, canEdit, onEdit, onCancel, onDelete, onSave }: {
  note: NoteV2; editing: boolean; canEdit: boolean; onEdit: () => void; onCancel: () => void; onDelete: () => void;
  onSave: (p: { body: string; mentions: string[]; visibility: Visibility }) => void;
}) {
  const t = useT();
  const [body, setBody] = useState(note.body);
  const [mentions, setMentions] = useState<string[]>(note.mentions ?? []);
  const [visibility, setVisibility] = useState<Visibility>(note.visibility);
  if (editing) {
    return (
      <div className="bg-surface-2 rounded px-3 py-2 space-y-1.5">
        <MentionInput value={body} onChange={setBody} mentions={mentions} onMentionsChange={setMentions} onSubmit={() => onSave({ body, mentions, visibility })} />
        <div className="flex items-center justify-between gap-2">
          <VisibilitySelect value={visibility} onChange={setVisibility} />
          <div className="flex gap-1"><button className="btn btn-ghost btn-sm" onClick={onCancel}>{t('team_cancel')}</button><button className="btn btn-sm btn-primary" disabled={!body.trim()} onClick={() => onSave({ body, mentions, visibility })}>{t('team_save')}</button></div>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-surface-2 rounded px-3 py-1.5 text-sm">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
        <span>
          <span className="font-medium text-ink-1">{note.author_name ?? t('team_unknown_author')}</span>
          <span className="ml-2 num">{fmtDateTime(note.updated_at ?? note.created_at)}</span>
          <span className={`badge ml-2 ${note.visibility === 'client' ? 'badge-pos' : 'badge-muted'}`}>{note.visibility === 'client' ? t('team_visibility_client') : t('team_visibility_internal')}</span>
        </span>
        {canEdit && <span className="flex gap-1"><button className="btn btn-ghost btn-sm" onClick={onEdit}>{t('team_edit')}</button><button className="btn btn-ghost btn-sm" onClick={onDelete} aria-label={t('team_delete')}>✕</button></span>}
      </div>
      <div className="whitespace-pre-wrap mt-0.5">{note.body}</div>
    </div>
  );
}

/** Count of unseen mentions of me (0 renders nothing). */
export function MentionsBadge() {
  const mentions = useMentions();
  const n = mentions.data?.length ?? 0;
  return n ? <span className="badge badge-neg num">{n}</span> : null;
}
