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
- **Generated reports:** HTML reports built from Meta data (e.g. captions) must not allow script injection.
- **Build and release pipeline:** GitHub Actions workflows in `.github/workflows/`.

Out of scope:

- Vulnerabilities in the Meta Graph API or Meta's platforms (report those to [Meta's bug bounty program](https://www.facebook.com/whitehat)).
- Attacks that require an attacker to already control the user's operating-system account on the same machine. Machine-bound encryption protects copied database files, not a compromised local session.
- Warnings caused by unsigned builds (Gatekeeper, SmartScreen).
- Issues in third-party dependencies without a demonstrated impact on MetaDash (please report them upstream; Dependabot alerts are monitored).

## Tips for users

- Treat your App Secret and access token like passwords. If you suspect a leak, reset the App Secret in the Meta App Dashboard (App settings → Basic → Reset) and generate a new token.
- Use a strong passphrase when exporting a `.metadash` transfer file that includes secrets, and delete the file after importing it.
- Download MetaDash only from the official [GitHub Releases](https://github.com/mbahadirs/metadash/releases) page.
