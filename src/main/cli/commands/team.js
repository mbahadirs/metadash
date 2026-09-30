import { EXIT } from '../exitCodes.js';
import { getTeamState, publishNow, pullNow } from '../../team/index.js';

/**
 * `team` command: metadash team status | team publish | team pull
 *   status   mode, team, last publish/pull, members
 *   publish  (publisher) write a snapshot to the shared folder now
 *   pull     (subscriber) fetch the latest snapshot and members' events now; (publisher) merge events
 */
const USAGE = 'metadash team status | team publish | team pull';

function summary(s) {
  return {
    mode: s.mode, team: s.name, teamId: s.teamId, folder: s.folder, encrypted: s.encrypted,
    lastPublishAt: s.lastPublishAt, lastPullAt: s.lastPullAt, snapshotAt: s.snapshotAt, publisher: s.publisher, error: s.error,
    members: s.members.map((m) => ({ name: m.name, handle: m.handle, role: m.role, self: m.isSelf })),
  };
}

export const command = {
  name: 'team',
  summary: USAGE,
  options: {},
  async run(_args, io) {
    const sub = io.positionals?.[0] ?? 'status';
    const state = getTeamState();
    try {
      if (sub === 'status') {
        io.out.result(summary(state));
        return EXIT.OK;
      }
      if (sub === 'publish') {
        if (state.mode === 'subscriber') { io.out.error('team publish: this install is a read-only subscriber'); return EXIT.READ_ONLY; }
        if (state.mode !== 'publisher') { io.out.error('team publish: not the publisher of a team (Settings → Team)'); return EXIT.USAGE; }
        io.out.result(summary(await publishNow()));
        return EXIT.OK;
      }
      if (sub === 'pull') {
        if (state.mode === 'none') { io.out.error('team pull: not in a team (Settings → Team)'); return EXIT.USAGE; }
        const next = await pullNow();
        io.out.result(summary(next));
        return next.error ? EXIT.PARTIAL : EXIT.OK;
      }
    } catch (e) {
      io.out.error(`team ${sub}: ${e?.message ?? e}`);
      return e?.code === 'TEAM_PASSPHRASE_REQUIRED' || e?.code === 'TEAM_DECRYPT' ? EXIT.AUTH : EXIT.ERROR;
    }
    io.out.error(`usage: ${USAGE}`);
    return EXIT.USAGE;
  },
};
