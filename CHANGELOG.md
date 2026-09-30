# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-09-30

MetaDash 2.0 brings everything since 1.2.0 together: more platforms (Facebook Pages, Threads, YouTube and TikTok), a content planner that publishes, an AI studio, a unified comment inbox, team workspaces, a headless CLI and an optional self-hosted publish worker. AI features are still **beta**, and TikTok is **experimental**. Existing databases are migrated automatically (migrations 008–014). To use the new permissions, renew your Meta token after updating.

### Added

**Platforms**

- **Provider layer:** every platform implements one provider interface (discover, profile, posts, post insights, daily insights, demographics, comments, maintenance, inbox) with declared capabilities and a primary metric. Screens and reports read capabilities, so a metric a platform does not have shows "—" instead of zero. Metric names fall back through candidate lists, and the name that works is remembered per platform. Guide for contributors: `docs/providers.md`.
- **Facebook Pages (optional):** opt-in Page tracking with the existing Meta token (plus `read_insights`). Daily viewers, views, post engagements, page views, follows and unfollows; post viewers, views, reactions, comments, shares and clicks; Page-level ad account linking.
- **Threads:** a separate connection (token or authorization code) with automatic refresh of the long-lived token. Views, likes, replies, reposts, quotes, link clicks, followers and demographics (100+ followers). Guide: `docs/threads-setup.md`.
- **YouTube:** connect channels with your own Google OAuth "Desktop app" client (loopback + PKCE; each channel has its own token). YouTube Data API v3 and YouTube Analytics: views, watch time, average view duration, subscribers gained/lost, likes, comments, shares, Shorts/video/live detection and demographics. A daily quota ledger per OAuth client, and a 30-day freshness warning to comply with Google's data policy. Disconnecting revokes access and can delete the channel's data. Guide: `docs/youtube-setup.md`.
- **TikTok (experimental):** Login Kit (loopback + PKCE, with a paste-code fallback page in `docs/oauth/callback.html`) and Display API. Profile, followers, likes, per-video views/likes/comments/shares; daily views and new followers are estimated from syncs. Sandbox and production apps. Guide: `docs/tiktok-setup.md`.
- **Platform filter and badges** on Overview, Content and the Planner, a per-platform split of followers and reach/views, and platform-specific KPIs, charts and tabs on the account page.
- **Settings → Connections:** status, connect, refresh and disconnect for every platform.

**Planner and publishing**

- **Planner** (`docs/planner.md`): month and week calendar with drag and drop (Alt/Option-drag duplicates, keyboard alternatives), unscheduled drafts, a list with bulk status changes, the publishing queue, approvals and an audit log.
- **Composer:** one post for several Instagram, Facebook Page and Threads accounts, with a caption and first comment per account, live per-platform counters, a local media library (images and MP4/MOV, deduplicated, probed without ffmpeg), alt text, live validation against each platform's limits, best-time suggestions, approximate previews, autosave with conflict detection, and per-account results with error codes and `fbtrace_id`.
- **Workflow:** draft → in review → approved → scheduled → published (plus changes requested, failed/partly published and archived), with an optional "Require approval before scheduling" setting.
- **Publishing** through the official APIs: Instagram (image, carousel, reel, story, first comment; resumable video upload), Facebook Pages (text, link, photo, album, video, reel; optionally scheduled on Facebook itself) and Threads (text, image, video, carousel, reply as first comment). A lease-based queue with retries, daily quota checks, missed-post handling, pause/resume and notifications. Media hosts for Instagram images and Threads: S3-compatible storage (R2, S3, B2, MinIO, Wasabi; signed locally with SigV4), an experimental Facebook Page host, or files you already host. Guide: `docs/publishing-setup.md`.
- **Background mode:** tray or menu bar icon, keep running when the window is closed, launch at login (hidden), a single-instance lock, a check after wake, and a confirmation before quitting while posts are due.
- **Client approval packs:** self-contained HTML (with an offline approve / request-changes form) or PDF with your branding. The client's response code is applied only to posts that have not changed since export.
- **Self-hosted publish worker (optional):** a zero-dependency Node 22 service (Docker image for amd64/arm64) that publishes queued Instagram, Facebook Page and Threads posts while your computer is off. It uses an HMAC-signed protocol, encrypts tokens at rest, accepts only publishing-scoped tokens by default, and recovers after a crash without publishing twice. Choose "Publish via: Worker" per post. Guide: `docs/worker.md`.

**AI (optional, bring your own key, beta)**

- **AI Studio** (`docs/ai-studio.md`): brand voice briefs per account (local caption statistics, optional AI-derived proposal), caption variants in the composer (optionally using the images), data-driven hashtag suggestions with lift, overused and forgotten-winner flags, monthly content ideas with Turkish and global special days that become Planner drafts at your best times, repurposing to carousel, Threads, Facebook or story frames, reply suggestions with anonymised commenters, and A/B caption experiments with bootstrap confidence intervals.
- Vision support, structured output, a "What will be sent?" preview for every AI action, a per-account AI opt-out, and usage and estimated cost per feature (Studio → Usage).

**Inbox, team and automation**

- **Unified inbox** (`docs/inbox.md`): comments from Instagram, Facebook Pages, Threads and YouTube in one list with filters, assignment, keyboard shortcuts, confirmed replies, hide/unhide, background polling every 30 minutes, optional AI sentiment, response-time metrics (first response time, answered %, within target %) in the health score, a "Community response" report section and overdue notifications.
- **Team workspaces** (`docs/team.md`): share a read-only workspace through a synced folder (Dropbox, iCloud Drive, OneDrive, Google Drive, NAS). The publisher writes a snapshot without secrets (optionally encrypted with a team passphrase); subscribers open it read-only. Roles (admin, analyst, client view with a PIN), and notes on accounts, posts and comments with @mentions and visibility.
- **Command-line tool** (`docs/cli.md`): `MetaDash --cli` runs headless: `sync`, `report` (same templates and PDF rendering as the app), `export`, `backup`, `accounts`, `status`, `inbox`, `worker` and `team`, with `--json` output and documented exit codes. **Settings → Command-line tool** installs a `metadash` command. The CLI can run next to the app thanks to a cross-process sync lease.

**Languages and docs**

- Translations moved to per-language JSON files (`src/renderer/locales/<lang>/*.json`, `src/main/locales/<lang>/*.json`). German and Spanish are added as partial languages that fall back to English. `npm run i18n:check` verifies keys and placeholders. Guide: `docs/translating.md`.
- New guides: YouTube, TikTok, Planner, publishing, AI Studio, inbox, team, CLI, worker, providers, translating, known limitations and a documentation index (`docs/README.md`), all in English and Turkish.
- Demo data now includes 8 Facebook Pages, 6 Threads profiles, 2 YouTube channels, 3 TikTok accounts, planner posts and inbox comments.

### Changed

- **Graph API v26.0** (was v21.0).
- **Setup has 7 steps:** Facebook Pages can be picked next to Instagram accounts, and an optional Threads step comes before the first sync. YouTube and TikTok are connected in Settings → Connections.
- Health score: the response component now uses the inbox's answered rate and within-target rate. Platforms without an inbox keep a re-weighted score.
- Compare warns when platforms are mixed, Reports grey out sections that no selected account supports, Presentation skips ad slides for platforms without ads, and Competitors lists Instagram accounts only.
- Token warnings name the platform and link to the right place. A failing Threads, YouTube or TikTok token no longer stops the rest of the sync (the run ends as "partial").
- The unsupported-metrics list shows the platform of each metric.
- The Studio inbox now shows the unified inbox.
- The app may now contact the platform APIs you connect (Threads, Google, TikTok), your media host, your worker and your AI provider. See "Data and privacy" in the README.

### Fixed

- Demo data: comments are never dated in the future, and demo syncs roll YouTube and TikTok forward too.
- Platform-specific token errors are no longer reported as Meta token problems.

### Security

- Tokens for every platform, S3 keys, the worker secret and the team key are encrypted at rest with the machine-bound key (AES-256-GCM). They are never written to the team folder, and they are exported only with a passphrase.
- OAuth sign-in uses PKCE and a one-shot `127.0.0.1` listener with a constant-time state check that closes after one request or 5 minutes.
- The worker protocol signs every request (HMAC-SHA256 with timestamp and nonce), seals tokens with a separate derived key, rate-limits clients and locks them out after repeated failures, and refuses broad tokens unless you allow them.
- AI prompts quote captions and comments as data, anonymise commenter handles, and never include account ids, usernames or tokens. Replies are never sent without confirmation.
- Client approval packs have a strict Content Security Policy and escape all captions. Their response code is a checksum, not a signature (see SECURITY.md).
- Providers are not loaded as runtime plugins; new platforms go through code review.
- The worker pairing string (`mdw1:…`) is treated as a credential: before the first token is sent, MetaDash shows the decoded worker address and asks for confirmation, and it warns about plain `http://` addresses that are not on this computer. Only paste pairing strings from a worker you run yourself.
- Behind the bundled Caddy proxy, the worker rate-limits and locks out per real client instead of per proxy address: `docker-compose.yml` sets `MD_TRUST_PROXY=1`, and `X-Forwarded-For` is honoured only from loopback or private-network peers (right-most public hop).
- CSV and Excel exports neutralise spreadsheet formulas: text cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return are prefixed with `'`.
- The Content Security Policy of packaged builds no longer allows connections to the Vite dev server.

### Known limitations

- TikTok is experimental: there are no daily analytics, reach, demographics or comments, daily values are estimated, and sandbox apps are limited to 10 target users.
- YouTube: if your OAuth consent screen stays in Testing, refresh tokens expire after 7 days. The Data API has a quota of 10,000 units per day per Google Cloud project, and Analytics data arrives 2–3 days late.
- Publishing is available only for Instagram, Facebook Pages and Threads. Instagram images and Threads media need a public media host. Posts that MetaDash sends need the app running unless you use the worker or schedule on Facebook.
- AI features are beta. Builds may be unsigned.
- Some platform limits and API behaviours could not be confirmed from the official docs. They are listed in `docs/known-limitations.md`; please report differences.

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

[Unreleased]: https://github.com/mbahadirs/metadash/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/mbahadirs/metadash/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/mbahadirs/metadash/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mbahadirs/metadash/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mbahadirs/metadash/releases/tag/v1.0.0
