# Security Policy

## Supported versions

Security fixes are made for the latest release only. Please make sure you can reproduce an issue on the most recent version from [GitHub Releases](https://github.com/mbahadirs/metadash/releases) before reporting it.

| Version | Supported |
| --- | --- |
| 1.x (latest) | Yes |
| Older | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub Security Advisories:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (or open https://github.com/mbahadirs/metadash/security/advisories/new).
3. Describe the issue, the affected version and operating system, steps to reproduce, and the potential impact. A proof of concept helps.

You can expect an acknowledgement within a week. We will keep you updated on the fix, and credit you in the advisory and release notes unless you prefer to stay anonymous. Please give us reasonable time to release a fix before disclosing the issue publicly.

## Scope

MetaDash is a local-first desktop app with no server component. Everything it stores lives on the user's computer. Relevant areas include:

- **Secret handling:** the Meta access token and App Secret are stored in the local SQLite database, encrypted with AES-256-GCM using a key derived from a machine identifier. `.metadash` transfer files can carry secrets encrypted with a user passphrase (scrypt + AES-256-GCM).
- **Electron hardening:** context isolation, sandboxed renderer, the preload API surface (`src/main/preload.cjs`), IPC handlers (`src/main/ipc/`), the Content Security Policy and the Electron fuses applied at packaging time (`scripts/afterPack.cjs`).
- **Untrusted input:** data returned by the Meta Graph API, imported `.metadash` / `.db` files, and queries entered in the read-only SQL console.
- **Generated reports:** HTML reports and client approval packs built from Meta data or planner captions must not allow script injection.
- **Background publishing (v1.4):** the tray/login-item lifecycle, the publishing worker and media hosts (see below).
- **Build and release pipeline:** GitHub Actions workflows in `.github/workflows/`.

Out of scope:

- Vulnerabilities in the Meta Graph API or Meta's platforms (report those to [Meta's bug bounty program](https://www.facebook.com/whitehat)).
- Attacks that require an attacker to already control the user's operating-system account on the same machine. Machine-bound encryption protects copied database files, not a compromised local session.
- Warnings caused by unsigned builds (Gatekeeper, SmartScreen).
- Issues in third-party dependencies without a demonstrated impact on MetaDash (please report them upstream; Dependabot alerts are monitored).

## Background publishing and stored tokens (v1.4)

- **Tokens are used unattended.** With scheduled publishing, MetaDash uses the stored Meta, Page and Threads tokens without you clicking anything, as long as the app runs, including in the tray and after a login start. The tokens stay encrypted at rest (AES-256-GCM, machine-bound key) and are decrypted only in the main process when a post is published. Quitting MetaDash from the tray stops all publishing, except posts handed to Facebook's own scheduler. To revoke access, remove the app in Meta's settings or reset the App Secret.
- **One process publishes.** A single-instance lock stops two copies of MetaDash (same user data) from publishing the same post. A per-target lease in the database backs this up.
- **Media host keys.** S3-compatible access keys are stored the same way as other secrets (`token:planner:s3`), shown only as "…last4", and used only from the main process. They are sent only to the endpoint you configure. Media goes from your computer to your bucket, and Meta fetches it from there. Use a bucket and key that are limited to MetaDash (least privilege), and add a lifecycle rule that deletes `metadash/` objects after a few days.
- **Launch at login.** The login item (macOS/Windows) or `~/.config/autostart/metadash.desktop` (Linux) starts only the MetaDash executable with `--hidden`. There are no other arguments and no shell.
- **Client approval packs are not authenticated.** A pack is a self-contained HTML/PDF file. Its strict Content Security Policy allows no network requests and no external resources. Captions are HTML-escaped, and internal notes are left out unless you include them. The response code carries an HMAC whose key is embedded in the pack itself. That HMAC detects corrupted codes and codes pasted into the wrong pack, but anyone holding the pack file can create a valid response. Treat a pasted response like an email from the client. Share packs only with the intended client, and check who sent a response before scheduling. Decisions for content that changed after the pack was created are never applied; they are reported as stale.

## Tips for users

- Treat your App Secret and access token like passwords. If you suspect a leak, reset the App Secret in the Meta App Dashboard (App settings → Basic → Reset) and generate a new token.
- Use a strong passphrase when exporting a `.metadash` transfer file that includes secrets, and delete the file after importing it.
- Download MetaDash only from the official [GitHub Releases](https://github.com/mbahadirs/metadash/releases) page.
