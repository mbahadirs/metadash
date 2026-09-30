import { EXIT } from '../exitCodes.js';
import { cliT, services, fmtTime } from '../args.js';
import { q } from '../../db/index.js';
import { listRuns, lastSuccessfulRun } from '../../db/queries/sync.js';
import { listProfiles } from '../../db/queries/profiles.js';
import { leaseHolder } from '../../db/queries/locks.js';
import { listAccounts } from '../../db/queries/accounts.js';
import { readToken } from '../../config/store.js';
import { enabledAuths } from '../../providers/index.js';
import { workerState } from '../../worker/sync.js';
import { getSession } from '../../team/session.js';

/**
 * `metadash status` — last sync, running sync (lease), connection/token health per auth profile, API quota ledger,
 * worker and team session. Read-only. --check exits 4 when a connection is missing, expired or unreadable
 * (for monitoring scripts). Tokens are never printed.
 */
const DAY_MS = 86_400_000;
const EXPIRING_DAYS = 7;

const DEFAULTS = {
  listRuns, lastSuccessfulRun, listProfiles, leaseHolder, readToken, enabledAuths, workerState, getSession,
  listAccounts: () => listAccounts({ unscoped: true }),
  quotaRows: () => q.all('SELECT provider, day, units FROM api_quota ORDER BY day DESC, provider LIMIT 50'),
  now: () => Date.now(),
};

/** Health of one profile row: demo | missing | expired | expiring | ok. Pure. */
export function tokenHealth(profile, { now, readable }) {
  if (String(profile.token_ref ?? '').startsWith('demo')) return 'demo';
  if (!readable) return 'missing';
  const exp = Number(profile.token_expires_at) || null;
  // Refreshable profiles (Google, TikTok) renew short-lived access tokens on their own during sync.
  if (exp && exp <= now) return profile.refresh_ref ? 'ok' : 'expired';
  if (exp && exp - now < EXPIRING_DAYS * DAY_MS && !profile.refresh_ref) return 'expiring';
  return 'ok';
}

export function collectStatus(s) {
  const now = s.now();
  const last = s.listRuns(1)[0] ?? null;
  const ok = s.lastSuccessfulRun();
  const holder = s.leaseHolder('sync');
  const connections = s.enabledAuths().flatMap((auth) => {
    const rows = s.listProfiles(auth, { activeOnly: true });
    if (!rows.length) return [{ auth, connected: false, health: 'not_connected' }];
    return rows.map((p) => {
      const exp = Number(p.token_expires_at) || null;
      return {
        auth, connected: true, profileId: p.id, label: p.label ?? null, externalId: p.external_id ?? null,
        expiresAt: exp, daysLeft: exp ? Math.floor((exp - now) / DAY_MS) : null, refreshable: !!p.refresh_ref,
        health: tokenHealth(p, { now, readable: !!s.readToken(p.token_ref) }),
      };
    });
  });
  const accounts = s.listAccounts();
  const byPlatform = {};
  for (const a of accounts) byPlatform[a.platform ?? 'instagram'] = (byPlatform[a.platform ?? 'instagram'] ?? 0) + 1;
  const latestDay = {};
  for (const r of s.quotaRows()) if (!latestDay[r.provider]) latestDay[r.provider] = r;
  const session = s.getSession();
  const worker = s.workerState();
  return {
    lastSync: last ? { runId: last.id, scope: last.scope, status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, errors: last.errorCount, message: last.errorSummary ?? null } : null,
    lastSuccessAt: ok?.finished_at ?? null,
    syncRunning: holder ? { by: holder.kind, since: holder.acquiredAt } : null,
    connections,
    accounts: { total: accounts.length, byPlatform },
    quota: Object.values(latestDay).map((r) => ({ provider: r.provider, day: r.day, units: r.units })),
    worker: { configured: !!worker?.configured, url: worker?.url ?? null, lastSyncAt: worker?.lastSyncAt ?? null, lastError: worker?.lastError ?? null },
    session: { role: session?.role ?? 'admin', readOnly: !!session?.readOnly, workspace: session?.workspace ?? 'local' },
  };
}

const BAD = new Set(['missing', 'expired', 'not_connected']);

export const command = {
  name: 'status',
  summary: 'metadash status [--check]',
  help: [
    'Shows the last sync, whether a sync is running, connection (token) health, API quota use, worker and workspace.',
    '',
    'Options:',
    '  --check   exit 4 when any enabled connection is missing, expired or unreadable (for monitoring)',
  ].join('\n'),
  options: { check: { type: 'boolean' } },
  async run(values, io) {
    const s = services(io, DEFAULTS);
    const st = collectStatus(s);
    const anyConnected = st.connections.some((c) => c.connected);
    const bad = st.connections.filter((c) => c.connected ? BAD.has(c.health) : false);
    const code = values.check && (bad.length || !anyConnected) ? EXIT.AUTH : EXIT.OK;
    if (io.out.json) { io.out.result({ ...st, exitCode: code }); return code; }
    io.out.result(human(st, cliT(io)));
    return code;
  },
};

function human(st, t) {
  const lines = [];
  const ls = st.lastSync;
  lines.push(`${t('cli_status_last_sync')}: ${ls ? `#${ls.runId} ${ls.scope} ${ls.status} ${fmtTime(ls.finishedAt ?? ls.startedAt)}${ls.errors ? ` (${ls.errors} errors)` : ''}` : t('cli_status_never')}`);
  lines.push(`${t('cli_status_last_success')}: ${st.lastSuccessAt ? fmtTime(st.lastSuccessAt) : t('cli_status_never')}`);
  if (st.syncRunning) lines.push(t('cli_status_running', { by: st.syncRunning.by, since: fmtTime(st.syncRunning.since) }));
  lines.push('', `${t('cli_status_connections')}:`);
  for (const c of st.connections) {
    if (!c.connected) { lines.push(`  ${c.auth.padEnd(8)} ${t('cli_status_not_connected')}`); continue; }
    const exp = c.expiresAt ? ` · ${t('cli_status_expires', { date: fmtTime(c.expiresAt), days: c.daysLeft })}` : '';
    lines.push(`  ${c.auth.padEnd(8)} ${c.label ?? ''} [${c.health}]${exp}`);
  }
  lines.push('', `${t('cli_status_accounts')}: ${st.accounts.total} (${Object.entries(st.accounts.byPlatform).map(([p, n]) => `${p} ${n}`).join(', ') || '-'})`);
  if (st.quota.length) lines.push(`${t('cli_status_quota')}: ${st.quota.map((r) => `${r.provider} ${r.units} (${r.day})`).join(', ')}`);
  lines.push(`${t('cli_status_worker')}: ${st.worker.configured ? `${st.worker.url ?? ''}${st.worker.lastSyncAt ? ` · ${fmtTime(st.worker.lastSyncAt)}` : ''}` : t('cli_status_off')}`);
  lines.push(`${t('cli_status_workspace')}: ${st.session.workspace} · ${st.session.role}${st.session.readOnly ? ` · ${t('cli_status_read_only')}` : ''}`);
  return lines.join('\n');
}
