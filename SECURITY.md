# Security Policy

## Supported versions

Security fixes are made for the latest release only. Please make sure you can reproduce an issue on the most recent version from [GitHub Releases](https://github.com/mbahadirs/metadash/releases) before reporting it.

| Version | Supported |
| --- | --- |
| 2.x (latest) | Yes |
| 1.x and older | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub Security Advisories:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (or open https://github.com/mbahadirs/metadash/security/advisories/new).
3. Describe the issue, the affected version and operating system, steps to reproduce, and the potential impact. A proof of concept helps. For the publish worker, include the worker version (`GET /v1/health`) and how it is deployed (Docker, reverse proxy, Tailscale).

Never include real tokens, app secrets, API keys or client data in a report. If you need to show a token, redact all but the last few characters.

You can expect an acknowledgement within a week. We will keep you updated on the fix, and credit you in the advisory and release notes unless you prefer to stay anonymous. Please give us reasonable time to release a fix before disclosing the issue publicly.

## Scope

MetaDash is a local-first desktop app with no MetaDash server. Everything it stores lives on the user's computer, except what the user sends to an optional self-hosted worker or a shared team folder. Relevant areas include:

- **Secret handling:** platform tokens (Meta, Threads, YouTube, TikTok), app and client secrets, AI keys, S3 keys, the worker secret and the team key are stored in the local SQLite database, encrypted with AES-256-GCM using a key derived from a machine identifier. `.metadash` transfer files and CLI backups can carry secrets encrypted with a user passphrase (scrypt + AES-256-GCM).
- **OAuth sign-in (YouTube, TikTok):** PKCE, the one-shot `127.0.0.1` loopback receiver and its state check (`src/main/oauth/`), and the static paste-code page `docs/oauth/callback.html`.
- **Electron hardening:** context isolation, sandboxed renderer, the preload API surface (`src/main/preload.cjs`), IPC handlers (`src/main/ipc/`), the Content Security Policy and the Electron fuses applied at packaging time (`scripts/afterPack.cjs`).
- **Untrusted input:** data returned by platform APIs (comments and captions in particular), imported `.metadash` / `.db` files, team snapshots and event logs from a shared folder, queries in the read-only SQL console and in **Ask your data**, and CLI arguments.
- **AI features:** prompt injection through captions or comments, data sent to the AI provider beyond what the "What will be sent?" preview shows, and the read-only SQL guard used by **Ask your data**.
- **Generated reports and exports:** HTML reports and client approval packs built from platform data or planner captions must not allow script injection, and CSV/Excel exports must not allow formula injection (cells starting with `=`, `+`, `-` or `@` are prefixed with `'`).
- **Background publishing:** the tray/login-item lifecycle, the local publishing queue and media hosts (see below).
- **Self-hosted publish worker** (`worker/`, `src/main/worker/`): the signed protocol, token sealing and storage, signed media links and crash recovery. The threat model is in [docs/worker.md](docs/worker.md#threat-model).
- **Team workspaces** (`src/main/team/`): what is written to the shared folder, snapshot encryption and the client-view PIN. Roles and the client view are documented as guardrails, not a security boundary ([docs/team.md](docs/team.md)), so a way to read data inside an open workspace is expected. A way to get secrets out of it, or into the shared folder, is in scope.
- **Build and release pipeline:** GitHub Actions workflows in `.github/workflows/`, including the worker image published to GHCR.

Out of scope:

- Vulnerabilities in the platforms themselves. Report those to [Meta's bug bounty program](https://www.facebook.com/whitehat), the [Google Bug Hunters program](https://bughunters.google.com/) or [TikTok's bug bounty program](https://hackerone.com/tiktok).
- Attacks that require an attacker to already control the user's operating-system account on the same machine. Machine-bound encryption protects copied database files, not a compromised local session.
- Warnings caused by unsigned builds (Gatekeeper, SmartScreen).
- Issues in third-party dependencies without a demonstrated impact on MetaDash (please report them upstream; Dependabot alerts are monitored).

## Background publishing and stored tokens

- **Tokens are used unattended.** With scheduled publishing, inbox polling and automatic syncs, MetaDash uses the stored tokens without you clicking anything, as long as the app runs, including in the tray and after a login start. The tokens stay encrypted at rest (AES-256-GCM, machine-bound key) and are decrypted only in the main process when a post is published. Quitting MetaDash from the tray stops all publishing, except posts handed to Facebook's own scheduler. To revoke access, remove the app in Meta's settings or reset the App Secret.
- **One process publishes.** A single-instance lock stops two copies of MetaDash (same user data) from publishing the same post. A per-target lease in the database backs this up. A post handed to the worker is skipped by the local queue, so it has exactly one publisher.
- **The worker gets only publishing tokens.** It receives one token per account (the Page token for Facebook, never your Meta user token for Facebook, never app secrets, AI keys or Google/TikTok tokens). Tokens with broader scopes are refused unless you allow them. See [docs/worker.md](docs/worker.md).
- **Pairing strings are credentials.** A `mdw1:…` pairing string decides where publishing tokens are sent. MetaDash shows the decoded worker address and asks for confirmation before the first token push, and warns about plain `http://` addresses that are not on this computer. Only paste pairing strings from a worker you run yourself.
- **Media host keys.** S3-compatible access keys are stored the same way as other secrets (`token:planner:s3`), shown only as "…last4", and used only from the main process. They are sent only to the endpoint you configure. Media goes from your computer to your bucket, and Meta fetches it from there. Use a bucket and key that are limited to MetaDash (least privilege), and add a lifecycle rule that deletes `metadash/` objects after a few days.
- **Launch at login.** The login item (macOS/Windows) or `~/.config/autostart/metadash.desktop` (Linux) starts only the MetaDash executable with `--hidden`. There are no other arguments and no shell.
- **Client approval packs are not authenticated.** A pack is a self-contained HTML/PDF file. Its strict Content Security Policy allows no network requests and no external resources. Captions are HTML-escaped, and internal notes are left out unless you include them. The response code carries an HMAC whose key is embedded in the pack itself. That HMAC detects corrupted codes and codes pasted into the wrong pack, but anyone holding the pack file can create a valid response. Treat a pasted response like an email from the client. Share packs only with the intended client, and check who sent a response before scheduling. Decisions for content that changed after the pack was created are never applied; they are reported as stale.

## Tips for users

- Treat app secrets, access tokens and API keys like passwords. If you suspect a leak, reset the App Secret in the Meta App Dashboard (App settings → Basic → Reset) and generate a new token; for YouTube and TikTok, revoke MetaDash's access in your Google or TikTok account and create a new client secret; rotate AI and S3 keys at the provider.
- If you run the worker, keep it on a private network (Tailscale, WireGuard) or behind HTTPS, and keep `MD_WORKER_DATA_KEY` out of your backups. Rotate the secret with `metadash worker rotate`.
- Use a strong passphrase when exporting a `.metadash` transfer file that includes secrets, and delete the file after importing it.
- Download MetaDash only from the official [GitHub Releases](https://github.com/mbahadirs/metadash/releases) page.
