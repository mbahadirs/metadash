# Architecture

[Türkçe](tr/architecture.md)

MetaDash is a single-user Electron desktop app. There is no MetaDash backend: the main process calls the platform APIs (Meta Graph API, Threads API, YouTube Data and Analytics APIs, TikTok Display API) directly, stores everything in a local SQLite database and serves derived data to a React renderer over IPC. The optional [self-hosted worker](worker.md) and [team folder](team.md) are the only components outside the desktop app, and both are run by you.

```
┌─────────────────────────── Renderer (sandboxed) ───────────────────────────┐
│ React 18 + Vite + TS + Tailwind                                            │
│ routes/ → hooks/queries.ts (TanStack Query) → lib/api.ts call() → window.api│
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │ contextBridge (src/main/preload.cjs)
                                       │ ipcRenderer.invoke / events
┌──────────────────────────────────────▼─────────────────────────────────────┐
│ Main process (Node, ES modules)                                            │
│ ipc/*.handlers.js ──► analytics/ ──► db/queries/ ──► better-sqlite3 (WAL)  │
│        │                                                ▲                  │
│        ├──► sync/orchestrator ──► sync/jobs ──► providers/<platform> ──► platform APIs
│        │         (p-queue, lease)              (retry, rate limits, quota) │
│        ├──► publishing/ · inbox/ · ai/ · team/ · worker/ (client)          │
│        └──► export/ (HTML, PDF, Excel, CSV, transfer)                      │
└────────────────────────────────────────────────────────────────────────────┘
```

## Process model

### Main process (`src/main`)

`src/main/index.js` is the entry point (`"main"` in `package.json`). On `app.whenReady()` it:

1. applies `METADASH_USER_DATA` if set, then opens `<userData>/data.db` and runs migrations;
2. seeds demo data when started with `--demo` in an unpackaged build and the database is empty;
3. applies the saved theme, registers IPC handlers, creates the window and starts the scheduler.

On quit it stops the scheduler and closes the database. When `METADASH_SMOKE=1` it also drives the smoke test (visits every route, captures screenshots, exits non-zero on renderer console errors).

### Preload (`src/main/preload.cjs`)

The preload script is the only bridge between the two worlds. It uses `contextBridge.exposeInMainWorld('api', …)` to expose a fixed, namespaced API (`setup`, `platforms`, `accounts`, `tags`, `notes`, `sync`, `analytics`, `ads`, `competitors`, `export`, `system`, `db`, `settings`, `sql`, `update`, `ai`, `planner`, `publishing`, `studio`, `inbox`, `worker`, `team`, `session`, `cli`, `app`, `transfer`) where each method maps to exactly one IPC channel. Event subscription (`api.on`) is limited to an allow-list: `sync:progress`, `sync:done`, `token:warning`, `update:status`, `app:navigate`, `planner:changed`, `publish:progress`, `publish:missed`, `studio:progress`, `studio:changed`, `inbox:updated`, `worker:status`, `team:status`, `session:changed`. The preload also rasterises chart SVGs to PNG on a canvas before handing the image to the main process to save.

### Renderer (`src/renderer`)

A React 18 single-page app built by Vite into `dist/renderer`, loaded with `loadFile` in production or from the Vite dev server in development (`VITE_DEV_SERVER_URL`). It uses `HashRouter`, TanStack Query for data fetching and caching, Zustand for UI state (`store/app.ts`), Recharts for charts and Tailwind for styling. It has no access to Node.js, the file system, the database or the token.

| Directory | Contents |
| --- | --- |
| `routes/` | One folder per screen: Overview, Account, Content, Compare, Ads, Competitors, Reports, Presentation, Planner, Studio, Inbox, Ask, Settings, Setup |
| `components/` | Layout, data table, post card/drawer, period picker, Excel/PDF buttons, UI primitives |
| `charts/` | Chart wrapper (PNG export), time series, heatmap, lifecycle, sparkline, bar list |
| `hooks/` | `queries.ts` (TanStack Query hooks per IPC call), `useSyncEvents.ts` (progress events) |
| `platforms/` | Per-platform UI vocabulary (label, icon, KPI tiles, charts, type keys) |
| `locales/` | UI strings as `<lang>/<namespace>.json`, and `keys.ts` (the key type) |
| `lib/` | `api.ts` (envelope unwrapping), `i18n.ts` (`t()` / `useT()`), formatting, ad metric definitions, types, `platforms.ts` (platform labels, fallback capabilities, type keys, profile URLs), `accountKpis.ts` (KPI tiles and chart series per platform) |

**Platform-aware UI (v1.3).** The renderer never hardcodes what a platform can show; it asks `platforms:list` (`hooks/usePlatforms.ts`: `usePlatforms`, `usePlatformCaps`, `useActivePlatforms`, `usePlatformScope`) and falls back to the same static capability table as `providers/capabilities.js`.

- `components/PlatformFilter.tsx`: an All chip plus one chip per tracked platform (Instagram, Facebook, Threads, YouTube, TikTok) on Overview, Content and the Planner. Only platforms with tracked accounts are offered and the control is hidden while only one platform exists. The selection lives in the Zustand store and is persisted as the `ui.platformFilter` setting; `usePlatformScope()` intersects it with the tracked platforms (empty = all) and `usePortfolio()` passes it as `platforms`.
- `components/PlatformBadge.tsx` and the `platform` prop of `Avatar` (a corner mark on Facebook/Threads avatars, and on Instagram ones too once several platforms are tracked).
- Missing capabilities show "—" with a "Not available for …" tooltip (save rate on Facebook/Threads, reach on Threads) or hide the element entirely. Account tabs follow capabilities (Instagram: all tabs; Facebook: overview/posts/ads; Threads: overview/posts/demographics). Compare warns about mixed platforms and disables save rate; Reports greys out sections none of the selected accounts support; Presentation drops ad slides for platforms without ads.
- Setup has seven steps: Welcome, Meta app, token (notes that `read_insights` is only needed for Facebook Pages), accounts (with an optional **Facebook Pages** list via `setup:facebook:*`), ad accounts, an optional **Threads** step (`setup:threads:*`) and the first sync. The persisted `setupStep` is 0-based (5 = Threads, 6 = first sync). **Settings → Connections** repeats the Facebook Page list and the Threads connect/refresh/disconnect controls; `token:warning` banners deep-link to the matching place (`meta` → Setup step 3, `threads` → Settings → Connections).

## IPC contract

Handlers are registered through a single wrapper in `src/main/ipc/index.js`:

```js
handle(channel, async (payload, event) => data)
// renderer receives
{ ok: true, data }                                  // success
{ ok: false, error: { code, message, hint } }       // failure
```

- The wrapper catches every exception, logs it with the channel name, and converts it with `toUserError()` (`src/main/meta/errors.js`) into a localized, user-facing message plus an optional hint (e.g. which permission is missing). Raw stack traces never reach the UI.
- On the renderer side, `call()` in `src/renderer/lib/api.ts` unwraps the envelope and throws an `ApiCallError` so TanStack Query can surface it.
- Handlers are grouped by domain in `src/main/ipc/*.handlers.js`: setup, accounts (plus tags and notes), sync, analytics, ads, export, system (settings, backup/restore, transfer, SQL console), competitors, platforms (`platforms:list`), update, AI, planner, publishing, studio, inbox, worker, team, session, CLI, app, and per-platform setup (`setup.facebook`, `setup.threads`, `setup.youtube`, `setup.tiktok`).
- Push events (the allow-list above) are emitted on an internal `progressBus` and broadcast to all windows.

## Database

- **Engine:** better-sqlite3 (synchronous, native), one connection opened in `src/main/db/index.js` with `journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`.
- **Location:** `<userData>/data.db`. `src/main/paths.js` mirrors Electron's `userData` resolution so CLI scripts (e.g. `scripts/seed.js`, run with `ELECTRON_RUN_AS_NODE=1`) use the same file.
- **Migrations:** numbered SQL files in `src/main/db/migrations/` (`001_init.sql`, `002_ad_breakdowns.sql`, …). On open, each file whose numeric prefix is not in `schema_version` is executed in its own transaction and recorded. Migrations are forward-only; to change the schema, add a new file with the next number.
- **Queries:** `src/main/db/queries/*.js` wrap prepared statements per domain (accounts, media, stories, ads, competitors, profiles, settings, sync, tags, planner, inbox, quota, …). A small helper `q` offers `all/get/run/tx`.
- **Concurrency:** the connection uses a 5 s `busy_timeout`, and a sync takes a cross-process lease in the `locks` table, so the CLI can run next to the app.
- **Main tables:** `settings` (JSON-encoded key/values, including encrypted secrets), `profiles`, `accounts`, `tags`/`account_tags`, `account_snapshots` (daily follower counts), `account_insights_daily`, `account_demographics`, `media`, `media_insight_snapshots` (time series per post, used for lifecycle curves), `media_latest`, `stories`, `comments`, `competitors`/`competitor_snapshots`, `ad_accounts`, `ad_insights_daily`, `ad_insights_breakdown`, `ad_media_links` (ad → Instagram post), `ad_budget_overrides`, `sync_runs`, `sync_errors`, `disabled_metrics`, `metric_resolution` (metric names that work per platform, v1.3), `notes`. Later migrations add the planner and publishing tables (009), AI Studio and usage (010), multi-profile auth, quota and locks (011), the inbox (012), team (013) and worker (014).

## Meta integration (`src/main/meta`)

| Module | Responsibility |
| --- | --- |
| `client.js` | `graphGet` / `graphGetAll` against `https://graph.facebook.com/v26.0`: adds the token, 30 s timeout, follows `paging.next`, exponential back-off for retryable codes (4, 17, 32, 613; up to 5 retries, capped at 60 s and scaled by the rate limiter). Counts API calls per sync. |
| `rateLimiter.js` | Reads `X-App-Usage` and `X-Business-Use-Case-Usage` headers after every response. The highest usage percentage sets a delay multiplier: ×2 above 80 %, ×4 above 95 %. Base delay is 250 ms (`METADASH_GRAPH_DELAY_MS`). |
| `errors.js` | `MetaError` (with `isRetryable`, `isTokenError` for 190/102, `isPermissionError`, `isInvalidParam`), `NetworkError`, and `toUserError()` for the IPC envelope. |
| `metricMap.js` | The single place where metric names per media family (feed, reels, carousel, story) and account level are defined, including aliases for renamed metrics (`impressions`/`plays` → `views`). |
| `auth.js` | Long-lived token exchange, token debugging, required/optional scopes. |
| `organic.js`, `stories.js`, `ads.js`, `competitors.js` | Fetchers for profiles, media, insights, demographics, comments, stories, ad insights (account/campaign/ad set/ad levels and age/gender/platform breakdowns), and Business Discovery for competitors. |

Account discovery combines `/me/accounts` (personal Page roles) with Business Manager `owned_pages` / `client_pages` and `owned_instagram_accounts` / `client_instagram_accounts` (requires `business_management`). Sources that cannot be scanned are reported as warnings in the Setup wizard.

When Meta rejects a metric with error code 100, the metric is removed from subsequent requests, recorded in `disabled_metrics` and listed in Settings, where it can be re-enabled.

## Providers (`src/main/providers`)

Since v1.3 every social platform is a *provider* behind one interface, so the sync job, analytics and UI stay platform-agnostic. Shared Meta plumbing (client, errors, rate limiter, auth, ads, competitors) stays in `src/main/meta`; `meta/organic.js`, `meta/stories.js` and `meta/metricMap.js` are re-export shims for the Instagram provider.

| Module | Responsibility |
| --- | --- |
| `index.js` | Registry: `listProviders()` (enabled providers, in order Instagram → Facebook → Threads → YouTube → TikTok), `getProvider(platform)`. Stub providers (`{ platform, enabled: false }`) are skipped. |
| `types.js` | JSDoc contract (`Provider`, `SyncContext`, `Post`, …): `discover`, `prepare?`, `fetchProfile`, `fetchPosts`, `fetchPostInsights`, `fetchDailyInsights`, `fetchDemographics?`, `fetchComments?`, `skipInsights?`, `maintenance?`, `refreshToken?`, `inbox?`, `demo?`, `dailyWindow`, `concurrency`, `auth`. See [providers.md](providers.md). |
| `capabilities.js` | Derived from every provider's `meta.js`: capabilities (reach, save rate, stories, demographics, competitors, comments, ads, inbox, watch time, daily series, experimental), primary metric (`reach`, or `views` for Threads, YouTube and TikTok) and account-key helpers. Exposed to the renderer through `platforms:list`. |
| `shared/insights.js` | Generic daily `/insights` loop (time series first, `total_value`-only metrics per day, unsupported metrics dropped). |
| `shared/metricFallback.js` | Canonical metric → candidate API names; the name that works is stored in `metric_resolution`, exhausted metrics are marked unsupported. |
| `shared/metaPages.js` | Facebook Page traversal (`/me/accounts` + Business Manager pages) shared by Instagram and Facebook discovery. |
| `shared/tiers.js` | Post-insight refresh tiers (`needsRefresh`). |
| `instagram/` | The Instagram provider (`api.js`, `stories.js`, `metrics.js`). `facebook/`, `threads/`, `youtube/` and `tiktok/` hold the other providers; `_template/` is a skeleton for new ones. |

Accounts of every platform live in `accounts`; the `ig_id` column is the *account key* (raw Instagram id, `fb-<pageId>`, `th-<userId>`, `yt-<channelId>`, `tt-<id>`) and `external_id` the raw API id. `profiles.platform` separates the connections; YouTube and TikTok have one profile (and token) per channel or account.

## Sync

### Orchestrator (`src/main/sync/orchestrator.js`)

`runSync({ scope, igIds, platforms })` with `scope` = `full | organic | stories | ads | competitors | inbox`:

1. Builds the job list from tracked accounts, tracked ad accounts and competitors (optionally narrowed to `igIds`).
2. Creates a `sync_runs` row and enqueues one job per account into dedicated [p-queue](https://github.com/sindresorhus/p-queue) queues:

   | Queue | Concurrency |
   | --- | --- |
   | organic (one queue per platform, created on first use) | provider `concurrency` (Instagram 2) |
   | stories (Instagram only) | 2 |
   | ads | 2 |
   | competitors | 1 |

3. Emits `sync:progress` (phase, current account, done/total, API calls) and finally `sync:done`. The run is `ok`, `partial` (some job errors, logged to `sync_errors`) or `failed`.
4. A Meta token error (190/102) stops the whole run and emits `token:warning` with `platform: 'meta'`; a Threads, YouTube or TikTok token error only skips that connection's remaining jobs (`token:warning` with the platform, `sync:done.invalidAuth`). A YouTube quota error stops only YouTube jobs for the day. A network error cancels the run so existing data stays untouched. `cancelSync()` aborts via an `AbortController` and clears the queues.

Only one sync runs at a time, across the app and CLI processes (lease in `locks`). If the active profile is a demo profile, `sync/demo.js` simulates the phases without network calls and advances the demo dataset by one day.

### Jobs (`src/main/sync/jobs`)

- **Organic account** (`platformAccount.js`, generic over providers; `organicAccount.js` is the Instagram wrapper): profile and follower snapshot → media list (incremental: from the last sync minus two days, or `mediaLookbackDays` on first sync) → media insights by **refresh tier** → daily account insights → demographics (weekly) → comments (optional). Captions are analyzed for length, hashtags, mentions and emoji (`sync/caption.js`).
- **Refresh tiers:** posts younger than 48 h are refreshed on every sync; up to 7 days old every `recent` hours (default 24); up to 30 days every `month` hours (168); older every `old` hours (720). Configurable in Settings.
- **Stories:** active stories and their insights.
- **Ads:** insights for account, campaign, ad set and ad levels plus age, gender and platform breakdowns, starting three days before the last stored date (or `adsLookbackDays`, default 90, on first sync); ads are linked to the Instagram posts they promote.
- **Competitors:** public counts via Business Discovery.

### Scheduler (`src/main/sync/scheduler.js`)

Each tick first runs every provider's `maintenance()` hook (e.g. Threads token refresh). Inbox polling (scope `inbox`, every 30 minutes by default) runs on its own timer and is skipped while another sync runs.

While the app is open, a 15-minute tick runs a stories sync when the last one is older than `storyIntervalHours` (default 4, `0` disables it), and a full sync once a day if `autoSyncDaily` is enabled. The UI also suggests a refresh when the last successful sync is older than 20 hours.

## Analytics (`src/main/analytics`)

All analytics are computed in the main process from SQLite and returned through IPC.

| Module | Purpose |
| --- | --- |
| `engagement.js` | Interactions (likes + comments + saved + shares), engagement rate by followers (default) and by reach, save rate; materializes `media_latest`. |
| `health.js` | Health score 0–100: growth 30 % + engagement 30 % + consistency 20 % + response rate 20 %, each normalized as a percentile within the portfolio. |
| `besttime.js` | 7 × 24 weekday/hour matrix of average engagement rate; cells with fewer than 3 posts are flagged. |
| `lifecycle.js` | Post lifecycle curves from `media_insight_snapshots` (age in hours vs. share of final value) and time to reach 80 %. |
| `anomaly.js` | Flags daily values deviating ±2σ from the trailing 30-day mean. |
| `portfolio.js`, `account.js`, `compare.js`, `content.js` | Screen-level aggregations for Overview, Account, Compare and Content. |
| `paid.js`, `blended.js`, `budget.js` | Shared paid-metric fields, organic + paid series, monthly budget pacing, forecasts and budget allocation. |
| `weeklyDigest.js` | Auto-generated weekly change digest text. |

## Exports (`src/main/export`)

| Module | Output |
| --- | --- |
| `htmlReport.js` | Report templates (client monthly/weekly/custom, portfolio, campaign, weekly digest, selected posts) rendered to a single self-contained HTML file. Charts are generated server-side as inline SVG (`svgCharts.js`); the optional logo is embedded as a data URL, so reports work offline. |
| `pdf.js` | Renders the same HTML in a hidden, sandboxed `BrowserWindow` and calls `printToPDF` (A4). |
| `xlsxReport.js`, `xlsx.js` | Multi-sheet Excel workbooks with exceljs (summary, daily series, posts, types/hashtags, stories, demographics, ads). |
| `tablePdf.js` | Any on-screen table as a landscape A4 PDF. |
| `reportI18n.js` | `makeL(lang)`: report strings from the `report` locale namespace, independent from the UI language. |
| `csv.js` | Predefined CSV exports and the read-only SQL console. Queries must start with `SELECT`/`WITH`, and write/DDL keywords (`insert`, `update`, `delete`, `drop`, `alter`, `create`, `attach`, `pragma`, …) are rejected. |

## Backup, restore and data transfer

- **Backup / restore** (`db:backup`, `db:restore`): a raw SQLite copy using better-sqlite3's online backup. Restore validates the SQLite header, keeps a `data.db.pre-restore-<timestamp>` copy of the current database, then swaps the file and reopens it. Secrets inside a raw backup are only readable on the same machine.
- **Data transfer** (`export/transfer.js`, `.metadash` files) moves everything to another computer:
  - *Export:* takes an online backup to a temp file, removes leftover settings from pre-1.0 builds, and for each secret either re-encrypts it with a user passphrase (scrypt N=16384 → AES-256-GCM, `pp:` prefix) or drops it when no passphrase is given. Adds a `transfer.meta` row, vacuums and writes the file.
  - *Inspect:* opens the file read-only and reports counts, schema version and whether a passphrase is needed.
  - *Import:* verifies the passphrase, keeps a `pre-import` copy, replaces the database, runs pending migrations, and re-encrypts secrets with the local machine key. Secrets encrypted for another machine are discarded.

## Configuration and secrets (`src/main/config`)

- `store.js` holds defaults (`theme`, `lang` = `en`, `autoSyncDaily`, `storyIntervalHours`, `refreshTiers`, `mediaLookbackDays`, …) stored in the `settings` table. The renderer can only write known keys or keys prefixed with `ui.`.
- Secrets (Meta token, App Secret) are encrypted with **AES-256-GCM**. The key is `SHA-256("metadash-store-v1|" + machineId)`, and `machine.js` derives `machineId` as a salted SHA-256 of the hardware UUID (macOS), `MachineGuid` (Windows) or `/etc/machine-id` (Linux), falling back to host name + CPU model + memory size. Electron's `safeStorage` is intentionally not used, because on macOS it goes through the Keychain and prompts for the login password with unsigned or re-signed builds.
- This protects secrets in a copied database file. It does not protect against someone with access to your user account on the same machine.

## Internationalization

| Layer | Files | Access |
| --- | --- | --- |
| Renderer UI | `src/renderer/locales/<lang>/<namespace>.json` | `t()` / `useT()` from `src/renderer/lib/i18n.ts` |
| Main-process messages (errors, dialogs) | `src/main/locales/<lang>/<namespace>.json` | `msg()` from `src/main/i18n.js` |
| Reports and approval packs | `src/main/locales/<lang>/report.json`, `approval.json` | `makeL(lang)` from `src/main/export/reportI18n.js` |
| Language list | `src/main/locales/index.json` | code, native name, Intl locale, `partial` flag |

English is the source and the fallback: English and Turkish are complete, German and Spanish are partial. The UI language defaults to English and is stored in the `lang` setting; reports take their own `lang` parameter. `npm run i18n:check` validates keys and placeholders. See [translating.md](translating.md).

## Security model

- **Window:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer only sees the preload API.
- **Content Security Policy** (`src/renderer/index.html`): `default-src 'self'`, `script-src 'self'`; images are allowed from `https:` and `data:` (platform CDN thumbnails and profile pictures) and `mdmedia:` (the private protocol for the local media library); `connect-src` allows only `'self'` in packaged builds (the local Vite dev server is allowed in development only).
- **Navigation:** `setWindowOpenHandler` denies all new windows; `http(s)` links are opened in the system browser. `system:openExternal` rejects non-http(s) URLs.
- **Network:** only the main process makes requests, and only to services you set up: the platform APIs you connect (`graph.facebook.com` and its upload hosts, `graph.threads.net`, Google's OAuth, YouTube Data and Analytics APIs, `open.tiktokapis.com`), your media host when publishing, your AI provider when AI is on and used, your self-hosted worker if paired, and in packaged builds GitHub (`api.github.com` / `github.com` release downloads) for update checks, which can be turned off in Settings. No telemetry. The full list is in the README under [Data and privacy](../README.md#data-and-privacy).
- **OAuth (YouTube, TikTok):** PKCE with a one-shot `127.0.0.1` loopback receiver (random port, constant-time state check, closes after one request or 5 minutes). The browser is opened with the system handler; the CLI prints the URL instead.
- **SQL console:** read-only statements only (see Exports).
- **Electron fuses** (`scripts/afterPack.cjs`, applied to packaged binaries by electron-builder):

  | Fuse | Setting | Effect |
  | --- | --- | --- |
  | `RunAsNode` | off | `ELECTRON_RUN_AS_NODE` cannot turn the app into a plain Node runtime |
  | `EnableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` is ignored |
  | `EnableNodeCliInspectArguments` | off | `--inspect` debugging flags are ignored |
  | `OnlyLoadAppFromAsar` | on | the app cannot be swapped for an unpacked folder |
  | `EnableEmbeddedAsarIntegrityValidation` | on (macOS) | a modified `app.asar` refuses to start |
  | `EnableCookieEncryption` | off | avoids a Keychain password prompt on macOS; no credentials are kept in cookies |
  | `GrantFileProtocolExtraPrivileges` | on | required for `loadFile()` from the asar |

- **Packaging:** `asar: true`, with only `better-sqlite3` unpacked. macOS builds use the hardened runtime and `resources/entitlements.mac.plist`.

## Testing

- **Unit and integration tests** (`tests/`, Vitest, `environment: node`) run under Electron's Node (`ELECTRON_RUN_AS_NODE=1`) so the native module ABI matches. `tests/fixtures/fakeFetch.js` routes requests to fake Meta, Threads, Google and TikTok APIs; the `sync.*.integration.test.js` suites run full syncs through the real orchestrator, and `providers.contract.test.js` checks every provider against the interface.
- **Type check:** `tsc --noEmit` for the renderer.
- **Translations:** `npm run i18n:check`.
- **Smoke tests:** `npm run smoke` launches the real app, visits every route and fails on renderer errors; `node scripts/cli-smoke.mjs` runs every CLI command against a temporary demo database; `sh worker/test/smoke.sh` builds and checks the worker image.

## Feature modules (v1.4–v2.0)

Each feature owns its own document; the sections below only point to them. For v2.0 the shared contracts (migrations
011–014, provider hooks, IPC stubs, preload surface) were laid down first so the features could be built in parallel.

### Planner and publishing

`src/main/planner/` (media library, probing, validation, best-time suggestions, approval packs) and
`src/main/publishing/` (lease-based queue, per-platform steps, limits, media hosts). The platform publishers themselves
live in `src/shared/publish/`, which is pure so the worker can reuse it. Background mode is in `tray.js` and
`lifecycle.js`. See [planner.md](planner.md) and [publishing-setup.md](publishing-setup.md).

### AI

`src/main/ai/`: providers (Anthropic SDK, OpenAI, Gemini, Ollama), structured output, vision, usage and pricing,
**Ask your data** (`ask/`, with a read-only SQL guard) and the Studio features (`studio/`). See [ai-studio.md](ai-studio.md).

### Providers and extensibility

Registry-driven platform metadata (`providers/<p>/meta.js` → `providers/capabilities.js`), provider hooks,
OAuth helpers (`src/main/oauth`) and the contract test. See [providers.md](providers.md).

### YouTube

See [youtube-setup.md](youtube-setup.md).

### TikTok (experimental)

See [tiktok-setup.md](tiktok-setup.md).

### Unified inbox

Generalises the v1.5 Studio inbox (comments, `comment_replies`) to every platform. See [inbox.md](inbox.md).

### Self-hosted publish worker

Optional Docker service that publishes queued planner targets (`executor = 'worker'`). See [worker.md](worker.md).

### Team workspaces and roles

Shared-folder snapshots, per-member event logs, roles and client view (UI guardrails, not a security boundary).
See [team.md](team.md).

### Command-line interface

`MetaDash --cli <command>` runs headless inside the Electron binary; data.db has a 5 s `busy_timeout` and sync
takes a cross-process lease (`locks` table), so the CLI can run next to the app. See [cli.md](cli.md).
