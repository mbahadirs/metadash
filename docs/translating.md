# Translating MetaDash

[Türkçe](tr/translating.md)

MetaDash is complete in **English** and **Turkish**. **German** and **Spanish** are partial: anything not translated yet is shown in English. Translations are plain JSON files, so you do not need to run the app to contribute, although checking your work in the app is recommended.

## File layout

```
src/main/locales/index.json                 languages: code, native name, Intl locale, partial flag
src/renderer/locales/<lang>/<namespace>.json   app interface (menus, buttons, pages)
src/main/locales/<lang>/<namespace>.json       messages from the main process, errors, report and approval-pack labels
```

Each file is a flat object of `"key": "text"`. English (`en`) is the source of truth: every key must exist there first. Files are split by feature (namespace) so that people working on different features do not edit the same file:

| Renderer namespace | Contents |
| --- | --- |
| `core` | Navigation, common labels, dashboards, setup, settings |
| `planner` | Content planner and approvals |
| `background` | Tray and background mode, publishing settings |
| `studio`, `studio.voice`, `studio.ideas`, `studio.inbox` | AI studio |

| Main namespace | Contents |
| --- | --- |
| `messages` | General messages (setup, sync, AI errors) |
| `errors` | Meta/network error messages and hints |
| `planner`, `publishing`, `background`, `studio*` | Feature messages |
| `report` | Headings and labels in HTML, PDF and Excel reports (`weekdays` is a comma-separated list, Sunday first) |
| `approval` | Labels in the client approval pack |

Keys in the renderer, and keys in the main `messages`-type namespaces, share one keyspace: a key may exist in only one namespace. `report` and `approval` are separate documents and may reuse names.

## Translating an existing language

1. Open the English file and the matching file in your language side by side.
2. Copy keys you want to translate into your file and replace the English text. Keep keys unchanged.
3. Run `npm run i18n:check` and fix anything it reports.
4. Review the result in the app: Settings → Theme · Language.

You do not need to translate everything at once. Missing keys fall back to English; `i18n:check` prints the percentage translated for each language.

## Adding a language

1. Add an entry to `src/main/locales/index.json`, for example:
   ```json
   { "code": "fr", "name": "Français", "englishName": "French", "dir": "ltr", "intl": "fr-FR", "reportIntl": "fr-FR", "dateFns": "fr", "partial": true }
   ```
   `name` is shown in the language switcher, `englishName` is used to tell the AI assistant which language to write in, and `intl` / `reportIntl` pick number and date formats.
2. Create `src/renderer/locales/fr/` and `src/main/locales/fr/` with one file per English namespace (an empty `{}` is fine to start).
3. Translate, run `npm run i18n:check`, and open a pull request. Remove `"partial": true` once the language is complete.

Regional variants (e.g. `de-AT`) fall back to the base language (`de`), then to English.

## Placeholders

Text in curly braces is filled in by the app: `"{n} posts"`, `"Connected as @{u}"`. Keep every placeholder from the English text, spelled exactly the same, and do not add new ones. You can move them within the sentence. `i18n:check` fails when placeholders differ.

## Tone and glossary

- Short, plain and friendly. Buttons are verbs ("Save", "Connect").
- Use the informal or formal register that is normal for software in your language, and keep it consistent. Turkish uses the polite plural ("siz" forms).
- Never translate platform and product names: Instagram, Facebook, Threads, Meta, Reels, Stories, MetaDash, Graph API Explorer.
- Common technical terms such as token, App ID, App Secret, API and hashtag stay in English unless your language has a well-established equivalent.
- Metric names follow the platform's own wording in your language where one exists (for example "Viewers" for Facebook reach).

## Checks

```bash
npm run i18n:check            # missing / extra keys, placeholder mismatches, duplicate keys, unknown keys used in code
node scripts/i18n-check.mjs --unused   # also lists keys without a literal call site (informational)
```

The check fails if English and Turkish differ, if placeholders do not match in any language, or if the code uses a key that English does not define. Partial languages only produce percentages.

## For developers

- Renderer: `t('key', lang?, vars?)` and `useT()` from `src/renderer/lib/i18n.ts`. The `Key` type is generated from the English JSON files (`src/renderer/locales/keys.ts`), so a typo in a key is a type error.
- Main process: `msg('key', vars, lang?)` from `src/main/i18n.js`; reports use `makeL(lang)` from `src/main/export/reportI18n.js`. Pure modules can import `translate()` from `src/main/locales/catalog.js`.
- Formatting: use `intlLocale(lang)` / `locale()` for `Intl` and `reportLocale(lang)` in exported documents instead of comparing language codes.
- New namespace: add `<ns>.json` for every language on the relevant side. In the renderer, also add it to the union in `src/renderer/locales/keys.ts`. In the main process it is picked up automatically (and merged into `msg()` unless it is listed in `DOCUMENT_NAMESPACES` in `catalog.js`).
