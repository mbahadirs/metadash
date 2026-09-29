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
npm run seed         # optional: 40-account demo dataset, no Meta app needed
npm run dev          # Vite + Electron with hot reload
```

Tips:

- Use `METADASH_USER_DATA=/some/dir` to keep a separate database for development (works with `npm run seed` and `npm run dev`).
- `npm run seed:reset` regenerates the demo data from scratch.
- Architecture, IPC conventions and the database layer are described in [docs/architecture.md](docs/architecture.md).

## Checks

Run these before opening a pull request; CI runs the first two plus a renderer build.

```bash
npm run typecheck    # TypeScript check of the renderer
npm test             # Vitest (runs under Electron's Node)
npm run smoke        # optional but recommended for UI changes: walks every screen with demo data
```

If `npm test` fails with a native module error (`NODE_MODULE_VERSION` mismatch), run `npm run rebuild`.

## Coding guidelines

- **Main process** (`src/main`): plain JavaScript ES modules. All database access goes through `src/main/db/queries/`, all Meta API access through `src/main/meta/client.js`.
- **IPC:** add a handler in the matching `src/main/ipc/*.handlers.js` with `handle(channel, fn)` so the renderer gets the standard `{ ok, data } | { ok: false, error }` envelope, then expose it in `src/main/preload.cjs`. Validate inputs in the handler.
- **Schema changes:** add a new numbered file in `src/main/db/migrations/` (e.g. `007_something.sql`). Never edit a migration that has already been released.
- **Metrics:** Graph API metric names live only in `src/main/meta/metricMap.js`.
- **Renderer** (`src/renderer`): TypeScript + React function components, TanStack Query hooks in `hooks/queries.ts`, Tailwind for styling. No Node APIs in the renderer.
- **Tests:** add or update tests in `tests/` for new logic, especially analytics, sync and anything that parses Meta responses.
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
- [ ] `npm run typecheck` and `npm test` pass.
- [ ] New or changed logic has tests.
- [ ] New UI strings are in `src/renderer/lib/i18n.ts` (and report/main-process strings in their files) in both English and Turkish.
- [ ] Schema changes use a new migration file.
- [ ] Docs are updated (README / `docs/`, English and Turkish where applicable).
- [ ] No secrets, tokens, personal data or database files are committed.
- [ ] User-visible changes are noted under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).

## Releases

Maintainers cut releases by bumping the version with `npm version <patch|minor|major>` and pushing the tag; GitHub Actions builds and publishes the installers. See [Releasing](README.md#releasing) in the README.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
