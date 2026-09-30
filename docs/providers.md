# Adding a platform (provider guide)

[Türkçe](tr/providers.md)

MetaDash talks to every social platform through a **provider**: a module in `src/main/providers/<platform>/` that
turns the vendor API into a small, common shape (profile, posts, post insights, daily insights, demographics,
comments). Everything above the provider layer (sync, analytics, reports, the UI) is platform-neutral and reads
**capabilities** instead of platform names.

## Architecture

```
providers/<p>/meta.js      static, pure metadata (label, auth, key prefix, capabilities, KPI vocabulary)
providers/metas.js         ordered list of every meta  ─┐ capabilities.js derives CAPABILITIES, PRIMARY_METRIC,
providers/index.js         ordered list of providers   ─┘ PLATFORM_LABELS, PLATFORM_AUTH, KEY_PREFIX, AUTHS
providers/<p>/index.js     the Provider object (API calls, mapping, hooks)
sync/orchestrator.js       one job per account, per-platform queues, token resolution, cross-process lease
sync/jobs/platformAccount.js  profile → posts → post insights → daily insights → derived series → demographics → comments
```

A platform is *registered* when it is listed in both `providers/metas.js` and `providers/index.js` (same order; a
test checks it). `enabled: false` providers are skipped by sync and by `platforms:list`; stubs marked
`contract: true` are still checked by `tests/providers.contract.test.js`. `providers/_template/` is a copyable
skeleton and is never registered.

## Interface reference

The full JSDoc contract is in `src/main/providers/types.js`. In short:

| Member | Required | Notes |
|---|---|---|
| `meta` | yes | the object from `meta.js`; the provider also spreads/copies `platform`, `auth`, `capabilities`, `primaryMetric` |
| `accountKey(externalId)` | yes | `meta.keyPrefix + externalId`; must round-trip through `platformOfKey` |
| `discover(ctx)` | yes | accounts the token can see → `{ items, warnings }` |
| `fetchProfile(ctx, account)` | yes | followers, media count, name, picture |
| `fetchPosts(ctx, account, { sinceUnix })` | yes | newest first until `sinceUnix`; `inline` counts are merged with insights |
| `fetchPostInsights` or `fetchPostInsightsBatch` | one of them | batch = one call for many posts (`{ values: { [mediaId]: {...} } }`) |
| `fetchDailyInsights(ctx, account, window)` | yes | `{ series: { metric: [{date, value}] }, dropped }`; return `{ series: {} }` when the API has none |
| `fetchDemographics` | when `capabilities.demographics` | weekly |
| `refreshToken(profile)` | multi-profile auths | refresh an access token from `profile.refresh_ref`; throw an auth error on `invalid_grant` |
| `inbox` | when `capabilities.inbox` (non-Meta) | an `InboxAdapter` (fetch / reply / hide, scopes, max reply length) |
| `reportSections`, `demo`, `computeKpi`, `maintenance` | optional | report sections, demo data, custom KPI tiles, scheduler housekeeping |
| `dailyWindow` | yes | `{ windowDays, maxLookbackDays, initialDays?, minSinceUnix?, refetchTrailingDays? }` |

## Sync job lifecycle

`platformAccount.js` runs, for every tracked account:

1. `prepare` (optional, e.g. Facebook Page token) → `fetchProfile` → a daily `account_snapshots` row.
2. `fetchPosts` since the last sync minus two days (first sync: `mediaLookbackDays`).
3. Post insights by refresh tier (fresh posts every sync, older ones less often), per post or batched.
4. Daily account insights, chunked by `dailyWindow`; `refetchTrailingDays` re-reads revised days.
5. Derived series when `capabilities.dailySeries === 'derived'` (`analytics/derived.js`).
6. Demographics weekly; comments when the inbox/comment module is on.

Errors: a token error (code 190) marks that auth invalid — for multi-profile auths only that channel/account —
and emits `token:warning`; permission/invalid-parameter errors are logged and the job continues; network errors
abort the run. Only a Meta token error aborts everything.

## Metric resolution and fallback

Vendor metric names change. Map them to canonical names (`views`, `reach`, `likes`, `comments`, `shares`,
`saved`, `follower_count`, `unfollows`, `watch_time_min`, …) in `metrics.js`, and use
`providers/shared/metricFallback.js` when a metric has candidate names across API versions: the winner is
remembered in `metric_resolution`, exhausted metrics are marked unsupported instead of failing every sync.

## Capabilities: hide, don't zero

Every capability key in `providers/capabilities.js CAPABILITY_SCHEMA` must be declared. The UI and reports hide
what a platform cannot measure (a YouTube channel has no reach; a TikTok account has no native daily series)
instead of showing zeros. New keys in v2.0: `inbox`, `inboxReply` (`true | false | 'scope'`), `watchTime`,
`dailySeries` (`'native' | 'derived' | 'none'`), `experimental`.

## Auth patterns

- **Meta token** (Instagram, Facebook): one long-lived user token, `profiles.platform = 'meta'`.
- **Threads long-lived token**: one profile, refreshed by `maintenance()`.
- **OAuth loopback + PKCE** (YouTube, TikTok): `src/main/oauth/pkce.js` (verifier/challenge/state),
  `loopback.js` (one-shot `127.0.0.1` receiver with constant-time state check) and `openUrl.js` (browser in the GUI,
  printed URL in the CLI). One `profiles` row per channel/account (`upsertExternalProfile`, `external_id`,
  `scopes`, `refresh_ref`); the sync resolves tokens with `await ctx.tokenForAccount(account)`.
- **Paste code**: when a vendor rejects loopback redirects, a static HTTPS page shows `code`/`state` for the
  user to paste; safe because the code is useless without the PKCE verifier kept on the machine.

Tokens are stored with `storeToken(...)` (encrypted, machine-bound) and never logged or exported.

## Rate limits and quotas

Use the shared limiter pattern (`meta/rateLimiter.js`) or the per-provider client `delay()`. Daily unit quotas
(YouTube Data API) are counted in the `api_quota` table (`db/queries/quota.js`); a quota error is a soft error
that stops only that provider's jobs.

## Testing with fakeFetch

`tests/fixtures/fakeFetch.js` routes requests by host to fixture handlers (`meta`, `threads`, `google`, `tiktok`
groups). A handler receives `{ url, path, query, method, body }` and returns a `Response` or `null`. Write a
fixture per vendor (`tests/fixtures/<vendor>.js`), unit tests for mappers and errors, and one integration test
that runs a full sync through the real orchestrator.

## Demo data

A provider's `demo.seed({ now, rng })` creates its own demo profile (`token_ref` starting with `demo`) and
accounts using the given PRNG stream, so existing demo data never changes. `demo.extendDay` rolls it forward on
demo syncs.

## i18n

Add `src/renderer/locales/<lang>/<platform>.json` and `src/main/locales/<lang>/<platform>.json` for every
language (en and tr complete, others may be `{}`), plus one `import type` line and union member in
`src/renderer/locales/keys.ts`. Platform names are never translated.

## Definition of done

- `meta.js`, registration lines, provider methods and hooks; `tests/providers.contract.test.js` passes.
- Renderer vocabulary in `src/renderer/platforms/<platform>.ts` (label, icon, KPI tiles, chart, type keys) and a
  connection card in `src/renderer/routes/Settings/connections/`.
- Setup IPC in `src/main/ipc/setup.<platform>.handlers.js`.
- Fixtures, unit tests and a sync integration test; `npm test`, `npm run typecheck`, `npm run i18n:check` pass.
- `docs/<platform>-setup.md` and `docs/tr/<platform>-setup.md`.

## Experimental policy

A provider whose API access is uncertain (review-gated scopes, sandbox limits) ships with
`experimental: true`: the UI shows an "Experimental" badge and the docs explain the limits. A provider that stops
being maintained stays flagged experimental, or is disabled, rather than silently showing wrong numbers.

## No runtime plugins

MetaDash does not load third-party provider code at runtime. Providers run in the main process next to
decrypted tokens, so new platforms are contributed through pull requests and reviewed like any other code.
