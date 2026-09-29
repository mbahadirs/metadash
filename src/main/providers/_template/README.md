# Provider template

Copy this folder to `src/main/providers/<platform>/` to add a platform. Full guide: `docs/providers.md`.

Checklist (definition of done):

1. `meta.js` — platform, label, auth, unique `keyPrefix`, every capability key, `primaryMetric`, `kpis`.
2. `index.js` — the Provider contract in `providers/types.js` (discover, fetchProfile, fetchPosts,
   fetchPostInsights or fetchPostInsightsBatch, fetchDailyInsights, optional demographics / inbox / demo /
   reportSections / refreshToken). Start with `enabled: false, contract: true`.
3. Register: one line in `providers/metas.js` and one in `providers/index.js` (same order).
4. OAuth: use `src/main/oauth/{pkce,loopback,openUrl}.js`; store tokens with `storeToken`, profiles with
   `upsertExternalProfile` (multi-profile auths).
5. Setup IPC: `src/main/ipc/setup.<platform>.handlers.js`; preload surface `api.setup.<platform>`.
6. Renderer: `src/renderer/platforms/<platform>.ts` (label, icon, KPI specs, chart) and a connection card in
   `src/renderer/routes/Settings/connections/`.
7. Strings: `src/renderer/locales/<lang>/<platform>.json` and `src/main/locales/<lang>/<platform>.json` (en + tr complete).
8. Tests: a fixture in `tests/fixtures/<vendor>.js` routed by `fakeFetch.js`; `tests/providers.<platform>.test.js`;
   `tests/providers.contract.test.js` must pass.
9. Docs: `docs/<platform>-setup.md` and `docs/tr/<platform>-setup.md`.
10. Flip `enabled: true` only when a full sync works against the fixtures.
