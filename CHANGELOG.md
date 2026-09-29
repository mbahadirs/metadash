# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Multi-platform, part 1: Facebook Pages and Threads next to Instagram.

### Added

- **Facebook Pages (optional):** track Pages with the existing Meta token (plus the optional `read_insights` permission). Pages are opt-in: pick them in Setup step 4 ("Facebook Pages (optional)") or in **Settings → Connections**. Daily viewers (Meta's page reach), views, post engagements, page views, new followers and unfollows; posts with viewers, views, reactions, comments, shares and clicks. Pages that you can't analyze (missing ANALYZE task) are shown but skipped. A Page can be linked to its own ad account.
- **Threads (optional):** a separate Threads connection with its own app ID/secret. Connect in the new optional Setup step 6 or in **Settings → Connections** by pasting a short-lived token or an authorization code; the long-lived token is refreshed automatically before it expires, and refresh failures show a "Reconnect Threads" banner. Daily views, likes, replies, reposts, quotes, link clicks and followers; post views, likes, replies, reposts, quotes and shares; audience demographics (age, gender, country, city; 100+ followers). Guide: `docs/threads-setup.md`.
- **Provider layer** (`src/main/providers`): every platform implements one provider interface (discover, profile, posts, post insights, daily insights, demographics, comments, maintenance) with a capability table and a primary metric (reach, or views for Threads). Metric names fall back through candidate lists and the working name is remembered per platform (`metric_resolution`).
- **Platform filter:** All / Instagram / Facebook / Threads chips on Overview and Content, shown once more than one platform is tracked and remembered between sessions, plus a per-platform split of followers, reach/views and posts on the Overview (with a note that followers can overlap across platforms).
- Platform badges on avatars, a "Text" content type for text/link posts, reposts/quotes/clicks columns when present, and **Settings → Connections** with the status of each platform, the Facebook Page list and the Threads connect/refresh/disconnect controls.
- Demo data includes Facebook Pages and Threads profiles.

### Changed

- **Graph API v26.0** (was v21.0).
- Screens follow each platform's capabilities instead of showing zeros: missing metrics show "—" with a "Not available for …" tooltip (save rate on Facebook and Threads, reach on Threads). Account tabs follow capabilities (Facebook: overview/posts/ads; Threads: overview/posts/demographics) with platform-specific KPIs and charts (Facebook: viewers + post engagements; Threads: views + likes). Compare warns when accounts from different platforms are mixed and disables save rate; Reports greys out sections that none of the selected accounts support; Presentation skips ad slides for platforms without ads; Competitors lists Instagram accounts only.
- Setup now has seven steps (the optional Threads step comes before the first sync); the token step explains that `read_insights` is only needed for Facebook Pages.
- Token warnings name the platform: a Meta problem links to Setup step 3, a Threads problem to Settings → Connections, and a failing Threads token no longer cancels the Instagram/Facebook sync (the run ends as "partial").
- The unsupported-metrics list in Settings shows the platform of each metric and re-enables it per platform.
- Account tracking, profile activation and sync errors are now platform-scoped internally (database migration 008).


## [1.2.0] - 2026-09-29

AI features are **beta**: they are off by default, need your own API key (or a local Ollama model) and have been tested against stubbed providers only. Please report problems.

### Added

- **White-label reports:** new **Settings → Report branding** section (agency name, logo, accent color, footer text, "Hide 'Generated with MetaDash' footer" toggle, live preview). Branding is applied to HTML/PDF reports, table PDF exports, the Excel title row and the presentation cover slide. Accounts can carry an optional client logo (Settings → Account management), shown on single-client reports. Logos are PNG/JPG/WebP/SVG, validated by content, downscaled and limited to 1 MB; SVGs with scripts are rejected and logos are only ever rendered as `<img>`.
- **AI assistant (optional, bring your own key):** new **Settings → AI assistant** section (off by default) with Anthropic (Claude, via the official `@anthropic-ai/sdk`: `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`), OpenAI, Google Gemini and local Ollama providers, encrypted per-provider API keys (write-only, shown as "set · …abcd"), a **Test connection** button and a privacy note. Nothing is sent to a provider unless the assistant is enabled and you use an AI feature.
- **Write with AI** on the Reports page drafts the report commentary (what happened, why, three next steps) from a compact summary of the same analytics the report uses (KPIs vs. previous period, top/bottom posts, ad spend and results), in the report language. The draft fills the commentary box for editing before export.
- **Needs attention** panel on the Overview lists ±2σ anomalies; with the assistant enabled each one has an **Explain** button that returns a short likely-cause explanation from the account's daily series ±7 days, posts in that window, ad spend/reach and posting frequency.
- **Ask your data (AI):** new sidebar screen for natural-language questions (EN/TR) about your analytics. The assistant queries the local SQLite database through two tools, `run_sql` (single read-only SELECT on a separate read-only connection, 200-row cap, 5 s time guard, rejects `settings`/`profiles`, token/secret identifiers, sqlite internals, table-valued pragmas and recursive CTEs) and `get_period` (today + the selected period), with a compact, deterministic schema description. Answers are rendered as safe Markdown (no HTML injection) with a copy button and a collapsible **How I found this** list of every query with a result preview. Requests can be cancelled; follow-up questions keep the last 6 question/answer turns as plain text. Available only when the AI assistant is enabled.

## [1.1.0] - 2026-09-29

### Added

- **Try it without a Meta app:** the Welcome step offers "Connect my accounts" or "Explore with demo data" (40 fictional accounts), now also in packaged builds.
- **App icon** for macOS, Windows and Linux (source: `resources/icon-src/icon.svg`).

- **Update checks and auto-update** (packaged builds only). MetaDash checks GitHub Releases shortly after start and every 6 hours. On Windows (NSIS) and Linux AppImage the update is downloaded in-app on request and installed on restart (electron-updater); on macOS (unsigned builds) and Linux `.deb` the app shows the new version and links to the release page. A top-bar badge appears when an update is available; **Settings → About** shows the installed version, a "Check for updates" button and a toggle to turn automatic checks off.
- **Desktop notifications** after each sync and once a day: unusual changes in the last 2 days, ad accounts at 90% of their monthly budget, accounts without posts for 7+ days, and a Meta token that expires within 7 days. Alerts are de-duplicated, never shown in demo mode, and each type can be turned off in **Settings → Notifications**. Clicking a notification opens the matching screen.

### Changed

- Demo data can be loaded in packaged builds (refused while a real Meta connection exists).

### Fixed

- After finishing setup or loading demo data, the Overview opens right away instead of redirecting back to Setup until the app is restarted.
- The app now also contacts `api.github.com` / `github.com` for update checks in packaged builds (can be turned off in Settings).

## [1.0.0] - 2026-09-28

First open-source release under the MIT License.

### Changed

- MetaDash is now free and open source. The licensing system (license keys, activation server, machine binding and code obfuscation) has been removed entirely; the app no longer contacts any server other than the Meta Graph API.
- The UI is now in English by default, with Turkish available in Settings. Main-process messages (errors, dialogs) are localized too.
- The Meta app setup guide is available in English (`docs/meta-app-setup.md`) and Turkish (`docs/tr/meta-app-setup.md`); the Setup wizard opens the one matching the UI language.
- Data transfer files (`.metadash`) no longer include license data; leftover license settings from earlier builds are removed on export and import.

### Added

- GitHub Actions workflows: CI (type check, tests, renderer build) and release builds for macOS (dmg/zip, arm64 and x64), Windows (NSIS installer) and Linux (AppImage and deb), published to GitHub Releases when a `vX.Y.Z` tag is pushed.
- Linux packaging (`npm run build:linux`).
- Project documentation: English and Turkish README, architecture overview, contributing guide, security policy and this changelog.

### Features in this release

- **Setup wizard:** Meta app credentials, short-lived to 60-day token exchange with permission check, account discovery across personal Page roles and Business Manager (owned and client Pages and Instagram accounts), ad account linking, first sync. Demo data for development builds.
- **Overview:** portfolio table with followers, net change, reach, engagement rate, save rate, health score, organic/paid reach and spend; tag filter, search and leaderboard.
- **Account detail:** follower and reach charts, KPIs vs. the previous period, health score breakdown, post grid and table, stories, demographics, best-time heatmap, post lifecycle curves, linked ad metrics and organic + paid view.
- **Content:** cross-account post table with filters and ad columns, content analysis (type breakdown, hashtag performance, top posts), report basket, post drawer with notes.
- **Compare:** account and post comparisons.
- **Ads:** consistent ad metric set, campaign/ad set/ad levels, age/gender/platform breakdowns, ad-to-post linking, organic + paid blend.
- **Budget tracking:** monthly budgets, calendar-month pacing, month-end forecast, boost candidates, and a campaign → ad set → ad budget allocation tree with overrides.
- **Competitors:** public competitor tracking via Business Discovery.
- **Reports:** monthly/weekly/custom client reports, portfolio summary, campaign report, weekly change digest and selected-posts report; exported as self-contained HTML, PDF or multi-sheet Excel, with logo, commentary, section selection, presets and a separate report language.
- **Presentation:** full-screen slide deck generated from account data.
- **Exports:** every table to Excel or PDF, every chart to PNG, CSV exports and a read-only SQL console.
- **Sync:** per-type queues, retry with exponential back-off, usage-header-aware rate limiting, tiered post insight refresh, scheduled story refresh, optional daily auto-sync, automatic handling of unsupported metrics.
- **Data:** local SQLite database, AES-256-GCM encrypted secrets, backup/restore, passphrase-protected data transfer between computers.
- **Security:** sandboxed renderer with context isolation, strict CSP, Electron fuses on packaged builds, hardened runtime on macOS.

[Unreleased]: https://github.com/mbahadirs/metadash/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/mbahadirs/metadash/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mbahadirs/metadash/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mbahadirs/metadash/releases/tag/v1.0.0
