import { EXIT } from '../exitCodes.js';
import { msg } from '../../i18n.js';

/**
 * `inbox` command (v2.0 chunk D).
 *   metadash inbox pull [--account @x|key]…        poll comments now (sync scope 'inbox'; exit 5 when a sync runs elsewhere)
 *   metadash inbox sla [--from D --to D] [--platform p]… [--account …]   first-response metrics (default: last 28 days)
 *   metadash inbox list [--status open|overdue|replied|done|all] [--limit n]   unanswered comments (text is data only)
 * io = { out, argv, positionals, lang, services? }; services = { runSync, inboxSla, listInbox, listAccounts } (tests).
 */
const DAY = 86_400_000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const oneLine = (s, n = 80) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n);

async function services(io) {
  const given = io.services ?? {};
  if (['runSync', 'inboxSla', 'listInbox', 'listAccounts'].every((k) => typeof given[k] === 'function')) return given;
  const [{ runSync }, { inboxSla }, inbox, accounts] = await Promise.all([
    import('../../sync/orchestrator.js'), import('../../inbox/sla.js'), import('../../db/queries/inbox.js'), import('../../db/queries/accounts.js'),
  ]);
  return { runSync, inboxSla, listInbox: inbox.listInbox, listAccounts: accounts.listAccounts, ...given };
}

function resolveAccountIds(refs, accounts, out, lang) {
  if (!refs?.length) return { ids: undefined };
  const ids = [];
  for (const ref of refs) {
    const clean = String(ref).replace(/^@/, '').toLowerCase();
    const hit = accounts.find((a) => a.igId === ref || String(a.username ?? '').toLowerCase() === clean);
    if (!hit) { out.error(msg('inbox_cli_unknown_account', { ref }, lang)); return { error: EXIT.USAGE }; }
    ids.push(hit.igId);
  }
  return { ids };
}

async function pull(values, io, svc) {
  const { ids, error } = resolveAccountIds(values.account, svc.listAccounts(), io.out, io.lang);
  if (error) return error;
  try {
    const res = await svc.runSync({ scope: 'inbox', igIds: ids });
    io.out.result(io.out.json ? res : msg('inbox_cli_pulled', { status: res?.status ?? 'ok' }, io.lang));
    return res?.status === 'partial' ? EXIT.PARTIAL : EXIT.OK;
  } catch (e) {
    if (e?.message === 'SYNC_LOCKED' || e?.message === 'SYNC_RUNNING') { io.out.error(msg('inbox_cli_locked', null, io.lang)); return EXIT.LOCKED; }
    if (e?.message === 'NO_PROFILE') { io.out.error(msg('inbox_cli_no_profile', null, io.lang)); return EXIT.AUTH; }
    throw e;
  }
}

function sla(values, io, svc) {
  const { ids, error } = resolveAccountIds(values.account, svc.listAccounts(), io.out, io.lang);
  if (error) return error;
  const to = values.to ?? ymd(Date.now());
  const from = values.from ?? ymd(Date.parse(to) - 27 * DAY);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) { io.out.error(msg('inbox_cli_bad_date', null, io.lang)); return EXIT.USAGE; }
  const res = svc.inboxSla({ from, to, accountIds: ids, platforms: values.platform?.length ? values.platform : undefined });
  if (io.out.json) { io.out.result({ from, to, ...res }); return EXIT.OK; }
  const names = new Map(svc.listAccounts().map((a) => [a.igId, a.username]));
  const rows = [...res.rows, { accountId: '*', platform: '', ...res.totals }].map((r) => ({
    account: r.accountId === '*' ? msg('inbox_cli_total', null, io.lang) : `@${names.get(r.accountId) ?? r.accountId}`, platform: r.platform,
    incoming: r.incoming, answered: r.answeredPct ?? '—', within: r.withinSlaPct ?? '—', median: r.medianFrtMin ?? '—', p90: r.p90FrtMin ?? '—', backlog: r.backlog,
  }));
  io.out.result(rows, { columns: [
    { key: 'account', label: 'account' }, { key: 'platform', label: 'platform' }, { key: 'incoming', label: 'incoming', align: 'right' },
    { key: 'answered', label: 'answered%', align: 'right' }, { key: 'within', label: `within${res.slaHours}h%`, align: 'right' },
    { key: 'median', label: 'medianMin', align: 'right' }, { key: 'p90', label: 'p90Min', align: 'right' }, { key: 'backlog', label: 'backlog', align: 'right' },
  ] });
  return EXIT.OK;
}

function list(values, io, svc) {
  const { ids, error } = resolveAccountIds(values.account, svc.listAccounts(), io.out, io.lang);
  if (error) return error;
  const status = values.status ?? 'open';
  if (!['open', 'unanswered', 'overdue', 'replied', 'done', 'ignored', 'all'].includes(status)) { io.out.error(msg('inbox_cli_bad_status', null, io.lang)); return EXIT.USAGE; }
  const limit = Math.min(200, Math.max(1, Number(values.limit) || 50));
  const res = svc.listInbox({ status, accountIds: ids, limit });
  if (io.out.json) { io.out.result(res); return EXIT.OK; }
  io.out.result(res.items.map((r) => ({ when: new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' '), platform: r.platform, account: `@${r.accountUsername}`, from: oneLine(r.username, 24), text: oneLine(r.text), status: r.overdue ? 'overdue' : r.status })), {
    columns: [{ key: 'when', label: 'when' }, { key: 'platform', label: 'platform' }, { key: 'account', label: 'account' }, { key: 'from', label: 'from' }, { key: 'status', label: 'status' }, { key: 'text', label: 'text' }],
  });
  return EXIT.OK;
}

export const command = {
  name: 'inbox',
  summary: 'metadash inbox pull [--account @x] | inbox sla [--from --to --platform] | inbox list [--status] [--json]',
  help: [
    'metadash inbox pull [--account @x]…   fetch new comments now',
    'metadash inbox sla [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--platform p]… [--account @x]…',
    'metadash inbox list [--status open|overdue|replied|done|all] [--limit n] [--account @x]…',
  ].join('\n'),
  options: {
    account: { type: 'string', multiple: true },
    platform: { type: 'string', multiple: true },
    from: { type: 'string' },
    to: { type: 'string' },
    status: { type: 'string' },
    limit: { type: 'string' },
  },
  async run(values, io) {
    const sub = io.positionals?.[0];
    const svc = await services(io);
    if (sub === 'pull') return pull(values, io, svc);
    if (sub === 'sla') return sla(values, io, svc);
    if (sub === 'list') return list(values, io, svc);
    io.out.error(msg('inbox_cli_usage', null, io.lang));
    return EXIT.USAGE;
  },
};
