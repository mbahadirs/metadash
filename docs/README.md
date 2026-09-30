# MetaDash documentation

[Türkçe](tr/README.md)

Guides for MetaDash 2.0. Start with the [README](../README.md) for an overview, downloads and a quick start.

## Getting started

| Guide | What it covers |
| --- | --- |
| [README: Quick start](../README.md#quick-start) | Demo mode, the 7-step Setup wizard and connecting more platforms |
| [README: Data and privacy](../README.md#data-and-privacy) | Where data is stored and what leaves your computer |
| [Known limitations](known-limitations.md) | What the platform APIs do not provide, API behaviour MetaDash assumes, and other limits |

## Platform setup

| Guide | Platforms |
| --- | --- |
| [Meta app setup](meta-app-setup.md) | Instagram, Facebook Pages, Meta Ads (one Meta app and token) |
| [Threads setup](threads-setup.md) | Threads (separate app credentials and token) |
| [YouTube setup](youtube-setup.md) | YouTube (your own Google OAuth "Desktop app" client) |
| [TikTok setup](tiktok-setup.md) | TikTok, experimental (your own TikTok developer app) |

## Features

| Guide | What it covers |
| --- | --- |
| [Planner](planner.md) | Calendar, composer, workflow, client approval packs, background mode |
| [Publishing setup](publishing-setup.md) | Publishing permissions, media hosts (S3-compatible, Facebook Page, already hosted), limits, what works while the computer is off |
| [AI Studio](ai-studio.md) | Brand voice, captions, hashtags, ideas, repurposing, reply suggestions, experiments, and what is sent to the AI provider |
| [Unified inbox](inbox.md) | Comments from every platform, replies, response-time metrics, sentiment, permissions |

## Advanced

| Guide | What it covers |
| --- | --- |
| [Team workspace and roles](team.md) | Sharing a workspace through a synced folder, roles, client view, notes and @mentions |
| [Command-line tool](cli.md) | Headless `sync`, `report`, `export`, `backup`, `status`, and scheduling with cron, launchd or Task Scheduler |
| [Self-hosted publish worker](worker.md) | Docker service that publishes while your computer is off: setup, TLS, protocol, threat model |

## Contributing

| Guide | What it covers |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | Development setup, checks, coding guidelines, commit messages |
| [Architecture](architecture.md) | Process model, IPC, database, providers, sync, exports, security model |
| [Adding a platform](providers.md) | The provider interface, capabilities, auth patterns, tests and definition of done |
| [Translating](translating.md) | Locale JSON files, adding a language, `npm run i18n:check` |
| [Security policy](../SECURITY.md) | Reporting vulnerabilities, scope, how tokens are handled |
| [Changelog](../CHANGELOG.md) | Release notes |
