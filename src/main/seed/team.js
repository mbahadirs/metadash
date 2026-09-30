import { q } from '../db/index.js';
import { upsertMember, upsertNoteByUid, selfMember } from '../db/queries/team.js';

/**
 * Demo team data: two teammates and a few notes with @mentions / client visibility on the first demo accounts.
 * Deterministic (no PRNG needed). Team tables survive clearAll(), so members are upserted; notes are cleared by it.
 * Called by seed/index.js seedDemo() inside its transaction.
 */
const DEMO_MEMBERS = [
  { id: 'demo-member-ayse', name: 'Ayşe Demir', handle: 'ayse', role: 'analyst' },
  { id: 'demo-member-mert', name: 'Mert Kaya', handle: 'mert', role: 'analyst' },
];

export function seedTeam({ now = new Date() } = {}) {
  const t = now.getTime();
  const accounts = q.all("SELECT ig_id FROM accounts WHERE is_tracked = 1 ORDER BY ig_id LIMIT 2").map((r) => r.ig_id);
  for (const m of DEMO_MEMBERS) {
    if (!q.get('SELECT 1 FROM team_members WHERE lower(handle) = ? AND id <> ?', m.handle, m.id)) upsertMember({ ...m, updatedAt: t });
  }
  if (!accounts.length) return { members: DEMO_MEMBERS.length, notes: 0 };
  const me = selfMember();
  const notes = [
    { uid: 'demo-note-1', entityId: accounts[0], author: DEMO_MEMBERS[0], body: '@mert reels are carrying reach this month, let us plan two more for next week.', mentions: [DEMO_MEMBERS[1].id], visibility: 'internal', ago: 3 },
    { uid: 'demo-note-2', entityId: accounts[0], author: DEMO_MEMBERS[1], body: 'Campaign launch moved to the 15th. Report numbers reflect the soft launch.', mentions: [], visibility: 'client', ago: 2 },
  ];
  if (me) notes.push({ uid: 'demo-note-3', entityId: accounts[1] ?? accounts[0], author: DEMO_MEMBERS[0], body: `@${me.handle} can you check the story drop-off before Friday?`, mentions: [me.id], visibility: 'internal', ago: 1 });
  for (const n of notes) {
    const at = t - n.ago * 86_400_000;
    upsertNoteByUid({
      uid: n.uid, entityType: 'account', entityId: n.entityId, body: n.body, mentions: n.mentions, visibility: n.visibility,
      authorId: n.author.id, authorName: n.author.name, createdAt: at, updatedAt: at, origin: 'local',
    });
  }
  return { members: DEMO_MEMBERS.length, notes: notes.length };
}
