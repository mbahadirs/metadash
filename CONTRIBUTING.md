# Contributing to MetaDash

Thanks for your interest in MetaDash. Bug reports, feature ideas, translations, documentation fixes and code are all welcome.

> **Türkçe not:** Issue ve pull request'leri Türkçe de açabilirsiniz; Türkçe katkılar memnuniyetle karşılanır. Kod içi yorumlar ve commit mesajları için İngilizce tercih edilir.

## Ground rules

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Keep pull requests focused: one feature or fix per PR.
- Never commit Meta tokens, App Secrets, real account data or database files. Use demo data for screenshots and tests.
- Report security issues privately as described in [SECURITY.md](SECURITY.md), not as public issues.

## Development setup

Prerequisites: Node.js 20+, npm, and a C/C++ toolchain in case `better-sqlite3` has to be compiled (see the [README](README.md#prerequisites)).

```bash
git clone https://github.com/<your-username>/metadash.git
cd metadash
npm install          # also rebuilds better-sqlite3 for Electron
npm run seed         # optional: demo data for every platform, no developer app needed
npm run dev          # Vite + Electron with hot reload
```

Tips:

- Use `METADASH_USER_DATA=/some/dir` to keep a separate database for development (works with `npm run seed` and `npm run dev`).
- `npm run seed:reset` regenerates the demo data from scratch.
- Architecture, IPC conventions and the database layer are described in [docs/architecture.md](docs/architecture.md). All guides are listed in [docs/README.md](docs/README.md).

## Checks

Run these before opening a pull request. CI runs the type check, the tests and a renderer build.

```bash
npm run typecheck    # TypeScript check of the renderer
npm test             # Vitest (runs under Electron's Node)
npm run i18n:check   # translation keys and placeholders; required when you touch UI or main-process strings
npm run smoke        # optional but recommended for UI changes: walks every screen with demo data
node scripts/cli-smoke.mjs   # optional, for CLI changes: runs every command against a temporary demo database
```

For changes to the publish worker, also run `sh worker/test/smoke.sh` (needs Docker).

If `npm test` fails with a native module error (`NODE_MODULE_VERSION` mismatch), run `npm run rebuild`.

## Coding guidelines

- **Main process** (`src/main`): plain JavaScript ES modules. All database access goes through `src/main/db/queries/`. Platform API access goes through the platform's provider in `src/main/providers/<platform>/` (Meta requests through `src/main/meta/client.js`).
- **New platforms:** follow [docs/providers.md](docs/providers.md) (provider interface, capabilities, fixtures, contract test, definition of done). Providers are not loaded as runtime plugins; they are contributed and reviewed like any other code.
- **Shared publishing code** (`src/shared/publish`) is used by both the app and the worker. Keep it pure: it may import only other files in `src/shared` and `node:` built-ins, and must not read `process.env` (`tests/shared.publish.purity.test.js` checks this).
- **IPC:** add a handler in the matching `src/main/ipc/*.handlers.js` with `handle(channel, fn)` so the renderer gets the standard `{ ok, data } | { ok: false, error }` envelope, then expose it in `src/main/preload.cjs`. Validate inputs in the handler.
- **Schema changes:** add a new numbered file in `src/main/db/migrations/` (the next one is `015_something.sql`). Never edit a migration that has already been released.
- **Metrics:** API metric names live in each provider's `metrics.js` (Instagram: `src/main/providers/instagram/metrics.js`). Everything above the provider layer uses canonical names.
- **Renderer** (`src/renderer`): TypeScript + React function components, TanStack Query hooks in `hooks/queries.ts`, Tailwind for styling. No Node APIs in the renderer.
- **Tests:** add or update tests in `tests/` for new logic, especially analytics, sync and anything that parses platform API responses. Use the fixtures in `tests/fixtures/` (`fakeFetch.js`) instead of real network calls.
- Match the style of the surrounding code; keep functions small and avoid unrelated reformatting.

## Translations

MetaDash ships complete in English (default) and Turkish; German and Spanish are partial and fall back to English for anything not yet translated. Strings live in one JSON file per language and feature:

| What | Files |
| --- | --- |
| UI strings | `src/renderer/locales/<lang>/<namespace>.json` |
| Main-process messages, errors, report and approval-pack labels | `src/main/locales/<lang>/<namespace>.json` |
| Language list (native name, Intl locale, partial flag) | `src/main/locales/index.json` |

To add or change a string, add the key to the English file and to `tr` (both are required), use it through `t('key')` / `useT()` in the renderer or `msg('key')` in the main process, then run `npm run i18n:check`. To translate or add a language, see [docs/translating.md](docs/translating.md) ([Türkçe](docs/tr/translating.md)).

Documentation is also bilingual: English files live in the repository root and `docs/`, Turkish translations in `README.tr.md` and `docs/tr/`. If you change one, update the other or mention it in the PR so someone can help.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

<optional body explaining what and why>
```

| Type | Use for |
| --- | --- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Tooling, dependencies, build config |
| `perf` | Performance improvement |
| `ci` | CI / GitHub Actions changes |

Examples: `feat: add reach column to competitor table`, `fix: handle empty demographics response`.

## Pull request checklist

- [ ] The PR has a clear description and links the related issue.
- [ ] `npm run typecheck`, `npm test` and `npm run i18n:check` pass.
- [ ] New or changed logic has tests.
- [ ] New strings are in the English and Turkish JSON files (`src/renderer/locales/<lang>/`, `src/main/locales/<lang>/`); German and Spanish may stay untranslated.
- [ ] Schema changes use a new migration file.
- [ ] Docs are updated (README / `docs/`, English and Turkish where applicable).
- [ ] No secrets, tokens, personal data or database files are committed.
- [ ] User-visible changes are noted under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- [ ] If the change relies on platform API behaviour that the vendor does not document, it is marked `VERIFY` in the code and listed in [docs/known-limitations.md](docs/known-limitations.md).

## Releases

Maintainers cut releases by bumping the version with `npm version <patch|minor|major>` and pushing the tag. GitHub Actions builds and publishes the installers and the worker image. See [Releasing](README.md#releasing) in the README.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
