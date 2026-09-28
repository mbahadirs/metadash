# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/mbahadirs/metadash/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mbahadirs/metadash/releases/tag/v1.0.0
