import { EXIT } from '../exitCodes.js';
import { listOpt, cliT, usageError, oneOf, services, fmtTime } from '../args.js';
import { selectAccounts, resolvePlatforms } from '../resolve.js';
import { runSync, cancelSync, setSyncLeaseOwner } from '../../sync/orchestrator.js';
import { progressBus } from '../../sync/progress.js';
import { makeOwner } from '../../db/queries/locks.js';
import { listAccounts } from '../../db/queries/accounts.js';
import { listTags } from '../../db/queries/tags.js';
import { listRuns, recentErrors } from '../../db/queries/sync.js';
import { KNOWN_PLATFORMS, ALL_PLATFORMS } from '../../providers/index.js';
import { getSession } from '../../team/session.js';

/**
 * `metadash sync` — runs a sync through the same orchestrator as the app (cross-process lease 'sync': when the app or
 * another CLI is syncing, exits 5). Waits for the run to finish, prints a summary.
 * Exit: 0 ok, 3 partial (some jobs failed), 4 auth (no connection / token invalid), 5 locked, 6 read-only workspace.
 */
export const SCOPES = Object.freeze(['full', 'organic', 'ads', 'stories', 'competitors', 'inbox']);

const DEFAULTS = {
  runSync, cancelSync, setSyncLeaseOwner, progressBus, getSession, listRuns, recentErrors,
  listAccounts: () => listAccounts({ unscoped: true }), listTags,
  knownPlatforms: KNOWN_PLATFORMS, enabledPlatforms: ALL_PLATFORMS,
  onSignal: (fn) => { process.once('SIGINT', fn); process.once('SIGTERM', fn); return () => { process.off('SIGINT', fn); process.off('SIGTERM', fn); }; },
};

export const command = {
  name: 'sync',
  summary: 'metadash sync [--scope full|organic|ads|stories|competitors|inbox] [--platform a,b] [--account @x …] [--client name] [--tag name]',
  help: [
    'Fetches fresh data from the connected platforms (same as the app\'s Refresh button) and waits until it finishes.',
    '',
    'Options:',
    '  --scope <scope>       full (default), organic, ads, stories, competitors, inbox',
    '  --platform <list>     only these platforms (instagram, facebook, threads, youtube, tiktok; aliases ig, fb, th, yt, tt)',
    '  --account <ref>       only these accounts (repeatable): @username, platform:@username or an account key',
    '  --client <name>       only accounts of this client (repeatable)',
    '  --tag <name>          only accounts with this tag (repeatable)',
    '',
    'Only one sync runs at a time across the app and the CLI; if one is running this exits with code 5.',
  ].join('\n'),
  options: {
    scope: { type: 'string' },
    platform: { type: 'string', multiple: true },
    account: { type: 'string', multiple: true },
    client: { type: 'string', multiple: true },
    tag: { type: 'string', multiple: true },
  },
  async run(values, io) {
    const s = services(io, DEFAULTS);
    const t = cliT(io);
    const { out } = io;
    if (s.getSession()?.readOnly) { out.error(t('cli_read_only')); return EXIT.READ_ONLY; }
    const scope = oneOf(io, values.scope ?? 'full', SCOPES, '--scope');
    const platforms = resolvePlatforms(listOpt(values.platform), s.knownPlatforms, { lang: io.lang });
    for (const p of platforms) if (!s.enabledPlatforms.includes(p)) out.warn(t('cli_platform_not_enabled', { platform: p }));
    const refs = listOpt(values.account);
    const clients = listOpt(values.client);
    const tags = listOpt(values.tag);
    let igIds;
    if (refs.length || clients.length || tags.length) {
      const sel = selectAccounts({ refs, clients, tags, platforms }, { accounts: s.listAccounts(), tagList: s.listTags() }, { lang: io.lang });
      if (!sel.accounts.length) throw usageError(io, 'cli_err_no_accounts');
      igIds = sel.accounts.map((a) => a.igId);
    }
    return runAndWait(s, io, { scope, platforms: platforms.length ? platforms : undefined, igIds });
  },
};

async function runAndWait(s, io, { scope, platforms, igIds }) {
  const t = cliT(io);
  const { out } = io;
  s.setSyncLeaseOwner(makeOwner('cli'));
  const startedAt = Date.now();
  let runId = null;
  const early = [];
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let last = '';
  const onProgress = (p) => {
    if (runId != null && p.runId !== runId) return;
    const line = `[${p.done}/${p.total}] ${p.phase ?? ''} ${p.currentAccount ?? ''}`.trimEnd();
    if (line !== last) { last = line; out.info(line); }
  };
  const onDone = (d) => { if (runId == null) early.push(d); else if (d.runId === runId) resolveDone(d); };
  s.progressBus.on('sync:progress', onProgress);
  s.progressBus.on('sync:done', onDone);
  const offSignal = s.onSignal(() => { out.warn(t('cli_sync_cancelling')); s.cancelSync(); });
  try {
    let started;
    try {
      started = await s.runSync({ scope, igIds, platforms });
    } catch (e) {
      return startError(io, e);
    }
    runId = started.runId;
    const first = early.find((d) => d.runId === runId);
    if (first) resolveDone(first);
    out.info(t('cli_sync_started', { runId, scope }));
    const result = await done;
    return summarize(s, io, { runId, scope, demo: !!started.demo, result, startedAt });
  } finally {
    offSignal();
    s.progressBus.off('sync:progress', onProgress);
    s.progressBus.off('sync:done', onDone);
  }
}

/** runSync refused to start: lease held elsewhere, no connection, unreadable token. */
function startError(io, e) {
  const t = cliT(io);
  if (e?.message === 'SYNC_LOCKED' || e?.code === 'SYNC_LOCKED') {
    const kind = e.holder?.kind;
    io.out.error(t(kind === 'gui' ? 'cli_sync_locked_app' : 'cli_sync_locked_other', { since: fmtTime(e.holder?.acquiredAt) }));
    return EXIT.LOCKED;
  }
  if (e?.message === 'SYNC_RUNNING') { io.out.error(t('cli_sync_locked_other', { since: '' })); return EXIT.LOCKED; }
  if (e?.message === 'NO_PROFILE') { io.out.error(t('cli_sync_no_profile')); return EXIT.AUTH; }
  if (e?.name === 'MetaError' && e.isTokenError) { io.out.error(t('cli_sync_token_invalid', { auth: e.source ?? 'meta' })); return EXIT.AUTH; }
  throw e;
}

/** Exit code for a finished run: auth problems win, then ok / partial / other failure. */
export function syncExitCode({ status, invalidAuth = [], tokenInvalid = false }) {
  if (invalidAuth.length || tokenInvalid) return EXIT.AUTH;
  if (status === 'ok') return EXIT.OK;
  return status === 'partial' ? EXIT.PARTIAL : EXIT.ERROR;
}

function summarize(s, io, { runId, scope, demo, result, startedAt }) {
  const t = cliT(io);
  const run = s.listRuns(50).find((r) => r.id === runId) ?? {};
  const errors = s.recentErrors(500).filter((e) => e.runId === runId);
  const invalidAuth = result.invalidAuth ?? [];
  const status = result.status ?? run.status ?? 'failed';
  const summary = {
    runId, scope, status, demo,
    accountsDone: run.accountsDone ?? null, accountsTotal: run.accountsTotal ?? null,
    apiCalls: result.apiCalls ?? run.apiCalls ?? 0, errors: result.errors ?? errors.length,
    invalidAuth, durationMs: Date.now() - startedAt, message: run.errorSummary ?? null,
    errorList: errors.slice(0, 20).map((e) => ({ account: e.username ?? e.igId ?? null, platform: e.platform ?? null, endpoint: e.endpoint, code: e.code, message: e.message })),
  };
  const code = syncExitCode({ status, invalidAuth, tokenInvalid: result.tokenInvalid });
  if (io.out.json) { io.out.result({ ...summary, exitCode: code }); return code; }
  io.out.result(t('cli_sync_summary', { status, done: summary.accountsDone ?? '?', total: summary.accountsTotal ?? '?', calls: summary.apiCalls, errors: summary.errors, seconds: Math.round(summary.durationMs / 100) / 10 }));
  if (demo) io.out.result(t('cli_sync_demo'));
  for (const e of summary.errorList) io.out.result(`  ! ${e.account ?? '-'} ${e.platform ? `(${e.platform}) ` : ''}${e.endpoint ?? ''} [${e.code ?? ''}] ${e.message ?? ''}`);
  if (invalidAuth.length) io.out.error(t('cli_sync_auth_failed', { list: invalidAuth.join(', ') }));
  return code;
}
