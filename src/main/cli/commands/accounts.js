import { EXIT } from '../exitCodes.js';
import { listOpt, services, fmtTime } from '../args.js';
import { selectAccounts, resolvePlatforms } from '../resolve.js';
import { listAccounts } from '../../db/queries/accounts.js';
import { listTags } from '../../db/queries/tags.js';
import { KNOWN_PLATFORMS } from '../../providers/index.js';

/**
 * `metadash accounts` — tracked accounts (the keys and @usernames other commands accept).
 */
const DEFAULTS = {
  listAccounts: (opts) => listAccounts(opts), listTags, knownPlatforms: KNOWN_PLATFORMS,
};

const COLUMNS = [
  { key: 'key', label: 'KEY' }, { key: 'platform', label: 'PLATFORM' }, { key: 'handle', label: 'USERNAME' },
  { key: 'name', label: 'NAME' }, { key: 'client', label: 'CLIENT' }, { key: 'followers', label: 'FOLLOWERS', align: 'right' },
  { key: 'synced', label: 'LAST SYNC' },
];

export const command = {
  name: 'accounts',
  summary: 'metadash accounts [--platform a,b] [--client name] [--tag name] [--search text] [--all]',
  help: [
    'Lists tracked accounts with their keys (use them, or @username / platform:@username, in --account).',
    '',
    'Options:',
    '  --platform <list>   only these platforms',
    '  --client <name>     only this client\'s accounts (repeatable)',
    '  --tag <name>        only accounts with this tag (repeatable)',
    '  --search <text>     username / name / client contains text',
    '  --all               include accounts that are not tracked',
  ].join('\n'),
  options: {
    platform: { type: 'string', multiple: true },
    client: { type: 'string', multiple: true },
    tag: { type: 'string', multiple: true },
    search: { type: 'string' },
    all: { type: 'boolean' },
  },
  async run(values, io) {
    const s = services(io, DEFAULTS);
    const platforms = resolvePlatforms(listOpt(values.platform), s.knownPlatforms, { lang: io.lang });
    const clients = listOpt(values.client);
    const tags = listOpt(values.tag);
    let accounts = s.listAccounts({ onlyTracked: !values.all, search: values.search || undefined, platforms: platforms.length ? platforms : undefined });
    if (clients.length || tags.length) accounts = selectAccounts({ clients, tags, platforms }, { accounts, tagList: s.listTags() }, { lang: io.lang }).accounts;
    const tagNames = new Map(s.listTags().map((t) => [t.id, t.name]));
    const rows = accounts.map((a) => ({
      key: a.igId, platform: a.platform ?? 'instagram', username: a.username, name: a.name ?? null, client: a.clientName ?? null,
      followers: a.followers ?? null, tracked: !!a.isTracked, tags: (a.tagIds ?? []).map((id) => tagNames.get(id)).filter(Boolean),
      lastSyncedAt: a.lastSyncedAt ?? null,
    }));
    if (io.out.json) io.out.result(rows);
    else io.out.result(rows.map((r) => ({ ...r, handle: `@${r.username}`, synced: fmtTime(r.lastSyncedAt) })), { columns: COLUMNS });
    return EXIT.OK;
  },
};
