import { getActiveProfile, upsertProfile, updateProfileToken } from '../db/queries/profiles.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import { storeToken, readToken, storeAppSecret, readAppSecret } from '../config/store.js';
import { exchangeLongLivedToken, debugToken, REQUIRED_SCOPES, OPTIONAL_SCOPES } from '../meta/auth.js';
import { discoverAccounts } from '../meta/organic.js';
import { discoverAdAccounts } from '../meta/ads.js';
import { upsertAccount, setTrackedAccounts, insertSnapshot, listAccounts, updateAccount } from '../db/queries/accounts.js';
import { upsertAdAccount, linkAdAccount, listAdAccounts } from '../db/queries/ads.js';
import { findOrCreateTag, setAccountTags } from '../db/queries/tags.js';
import { isDemoProfile } from '../sync/orchestrator.js';
import { seedDemo, isSeeded, clearAll } from '../seed/index.js';
import { fmtDate } from '../analytics/util.js';
import { MetaError } from '../meta/errors.js';
import { app } from 'electron';
import { msg } from '../i18n.js';

function requireToken() {
  const profile = getActiveProfile();
  if (!profile) throw new MetaError({ code: 190, message: 'no profile' });
  if (isDemoProfile(profile)) return { profile, token: 'demo' };
  const token = readToken(profile.token_ref);
  if (!token) throw new MetaError({ code: 190, message: 'token missing' });
  return { profile, token };
}

export function registerSetupHandlers(handle) {
  handle('setup:getState', () => {
    const profile = getActiveProfile();
    return {
      step: getSetting('setupStep', 0),
      complete: !!getSetting('setupComplete', false),
      demo: isDemoProfile(profile),
      hasApp: !!profile?.app_id && profile.app_id !== '',
      appId: profile?.app_id ?? getSetting('pendingAppId', null),
      hasToken: !!profile && (isDemoProfile(profile) || !!readToken(profile.token_ref)),
      trackedCount: listAccounts().length,
      adAccountCount: listAdAccounts().length,
      requiredScopes: REQUIRED_SCOPES,
      optionalScopes: OPTIONAL_SCOPES,
    };
  });

  handle('setup:setStep', (step) => { setSetting('setupStep', step); return step; });

  handle('setup:saveApp', ({ appId, appSecret }) => {
    if (!/^\d{5,}$/.test(String(appId ?? '').trim())) throw new Error(msg('app_id_digits'));
    if (!appSecret || String(appSecret).length < 16) throw new Error(msg('app_secret_short'));
    setSetting('pendingAppId', String(appId).trim());
    storeAppSecret(String(appId).trim(), String(appSecret).trim());
    setSetting('setupStep', Math.max(getSetting('setupStep', 0), 2));
    return { appId: String(appId).trim() };
  });

  handle('setup:exchangeToken', async ({ shortToken }) => {
    const appId = getSetting('pendingAppId') ?? getActiveProfile()?.app_id;
    const appSecret = appId ? readAppSecret(appId) : null;
    if (!appId || !appSecret) throw new Error(msg('save_app_first'));
    if (!shortToken || String(shortToken).length < 20) throw new Error(msg('token_empty'));
    const { token, expiresIn } = await exchangeLongLivedToken({ appId, appSecret, shortToken: String(shortToken).trim() });
    const health = await debugToken(token);
    const expiresAt = health.expiresAt ?? (expiresIn ? Date.now() + expiresIn * 1000 : Date.now() + 60 * 86_400_000);
    const existing = getActiveProfile();
    const ref = storeToken(`profile:${appId}`, token);
    if (existing && !isDemoProfile(existing) && existing.app_id === appId) updateProfileToken(existing.id, ref, expiresAt);
    else upsertProfile({ label: msg('meta_connection'), appId, tokenRef: ref, tokenExpiresAt: expiresAt });
    setSetting('setupStep', Math.max(getSetting('setupStep', 0), 3));
    return { ...health, expiresAt };
  });

  handle('setup:getTokenHealth', async () => {
    const profile = getActiveProfile();
    if (!profile) return { valid: false, reason: 'no_profile' };
    if (isDemoProfile(profile)) {
      return { valid: true, demo: true, expiresAt: profile.token_expires_at, daysLeft: Math.floor((profile.token_expires_at - Date.now()) / 86_400_000), scopes: [...REQUIRED_SCOPES, 'business_management'], missingScopes: [], optionalScopes: OPTIONAL_SCOPES.map((s) => ({ scope: s, granted: s === 'business_management' })) };
    }
    const token = readToken(profile.token_ref);
    if (!token) return { valid: false, reason: 'no_token' };
    try {
      const health = await debugToken(token);
      if (health.expiresAt) updateProfileToken(profile.id, profile.token_ref, health.expiresAt);
      return health;
    } catch (e) {
      return { valid: false, reason: 'error', error: e.message, expiresAt: profile.token_expires_at, daysLeft: profile.token_expires_at ? Math.floor((profile.token_expires_at - Date.now()) / 86_400_000) : null };
    }
  });

  handle('setup:discoverAccounts', async () => {
    const { profile, token } = requireToken();
    if (token === 'demo') {
      return { items: listAccounts({ onlyTracked: false }).map((a) => ({ pageId: a.pageId, pageName: a.name, ig: { ...a, followers: a.followers }, tracked: a.isTracked, known: true, sources: ['demo'] })), warnings: [], businesses: [] };
    }
    const pages = await discoverAccounts(token);
    const known = new Map(listAccounts({ onlyTracked: false }).map((a) => [a.igId, a]));
    for (const p of pages) {
      if (!p.ig) continue;
      upsertAccount({ ...p.ig, profileId: profile.id, pageId: p.pageId, isTracked: known.get(p.ig.igId)?.isTracked ?? true });
      insertSnapshot({ igId: p.ig.igId, date: fmtDate(new Date()), followers: p.ig.followers, follows: p.ig.follows, mediaCount: p.ig.mediaCount });
    }
    setSetting('setupStep', Math.max(getSetting('setupStep', 0), 4));
    const rows = pages.map((p) => ({ ...p, tracked: p.ig ? (known.get(p.ig.igId)?.isTracked ?? true) : false, known: p.ig ? known.has(p.ig.igId) : false }));
    return { items: rows, warnings: pages.warnings ?? [], businesses: pages.businesses ?? [] };
  });

  handle('setup:saveTrackedAccounts', ({ igIds, meta = {} }) => {
    setTrackedAccounts(igIds);
    for (const [igId, m] of Object.entries(meta)) {
      updateAccount(igId, { clientName: m.clientName });
      if (m.tags?.length) setAccountTags(igId, m.tags.map((name) => findOrCreateTag(name).id));
    }
    setSetting('setupStep', Math.max(getSetting('setupStep', 0), 5));
    return { tracked: igIds.length };
  });

  handle('setup:discoverAdAccounts', async () => {
    const { profile, token } = requireToken();
    if (token === 'demo') return listAdAccounts();
    const found = await discoverAdAccounts(token);
    for (const a of found) upsertAdAccount({ actId: a.actId, profileId: profile.id, name: a.name, currency: a.currency, status: a.status });
    return listAdAccounts();
  });

  handle('setup:linkAdAccount', ({ actId, igId }) => { linkAdAccount(actId, igId); return listAdAccounts(); });

  handle('setup:complete', () => { setSetting('setupComplete', true); setSetting('setupStep', 6); return true; });

  handle('setup:loadDemo', ({ reset = false } = {}) => {
    if (app.isPackaged) throw new Error(msg('demo_dev_only'));
    const res = seedDemo({ reset });
    return { ...res, seeded: isSeeded() };
  });

  handle('setup:resetAll', () => {
    clearAll();
    setSetting('setupComplete', false);
    setSetting('setupStep', 0);
    setSetting('demoMode', false);
    return true;
  });
}
