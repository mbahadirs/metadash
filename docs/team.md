# Team workspace and roles (no server)

[Türkçe](tr/team.md)

MetaDash v2.0 lets a small team share one workspace through a folder that is already synced between their
computers: Dropbox, iCloud Drive, OneDrive, Google Drive for desktop or a NAS/SMB share. There is no MetaDash
server and no account system.

> **Roles are guardrails, not security.** Roles and the client view are workflow guardrails on a machine you do not
> control. They are not a security boundary. Anyone who has the snapshot file, or who uses a computer while the
> workspace is open, can read the data. Encryption protects the shared folder, not a computer where the workspace
> is unlocked. Do not share a workspace with people who must not see all of its data.

## Model

- **Publisher** (one install, admin): keeps the tokens, runs sync, and writes a stripped snapshot of its database to
  the shared folder. It publishes after every successful sync and at least once an hour.
- **Subscribers** (any number): open the latest snapshot **read-only** in their own copy of the workspace. Sync,
  setup, replying to comments, hiding comments and publishing posts are disabled, because subscribers have no tokens.
- **Collaboration** (notes, @mentions, inbox status and assignment) travels as **per-member append-only event logs**.
  Each file has exactly one writer, so sync-client conflicts cannot happen. Merging is last-writer-wins per note or
  comment, with tombstones for deleted notes. Applying events is idempotent.

## Setting up

1. Everyone: **Settings → Team → Your identity**. Set a name and a handle (`@handle`, used for mentions).
2. Publisher (admin): **Create a team**. Choose the synced folder, give the team a name, and optionally encrypt
   snapshots with a passphrase (8+ characters). Share the passphrase with teammates **outside** the folder.
3. Teammates: **Join a team**. Choose the same synced folder (the folder itself, its `MetaDash` subfolder or the
   team folder all work) and enter the passphrase if the team is encrypted.

A subscriber shows the banner *"Shared workspace, data as of … from …"*. It checks the folder every minute and
whenever the window regains focus (`fs.watch` is unreliable on cloud folders). **Check for updates** checks now.

**Leave team** returns a subscriber to its own database, which was never touched while it was subscribed. You can
keep or delete the local copy of the shared data. A publisher that leaves keeps its data and stops publishing. The
folder is left as it is.

## What is in the shared folder

```
<shared>/MetaDash/<teamId>/
  team.json                              team name, format version, publisher id, encryption salt + key check
  snapshot/manifest.json                 current snapshot id, file, sha256, size, schema version, app version, time
  snapshot/<id>.metadash[.enc]           the last 3 snapshots
  members/<memberId>.json                name, handle, role (informational)
  events/<memberId>.jsonl                that member's notes / inbox status / mention-seen events
```

The snapshot is written first (temp file, fsync, rename), and only then is the manifest replaced. Subscribers wait
until the snapshot's size and sha256 match the manifest, because cloud clients sync large files in pieces. A
snapshot from a newer MetaDash (higher schema version) is not opened. The banner asks you to update instead.
Conflict copies (`… (conflicted copy …)`, `name (1).ext`, `name 2.ext`) are ignored.

### Never written to the folder

- Any secret (`token:*`): Meta/Threads/YouTube/TikTok tokens, app secrets, AI keys and S3 keys. Token references
  on profiles are blanked.
- Settings outside a small allowlist (report branding, setup state, demo flag, disabled metrics). Your language,
  theme, notification preferences and AI settings stay on your computer.
- AI history, sync error logs, API quota and lease bookkeeping, worker tokens, unsent reply drafts, and your
  "mention seen" marks.

### Encryption

Optional. The whole snapshot is encrypted (AES-256-GCM in 1 MB chunks, file header `MDX1`). The key is derived
from the team passphrase with scrypt. `team.json` stores only a salt and a key check, never the passphrase. Each
install keeps the derived key encrypted with its own machine key. Event logs and member files are not encrypted.
Do not put confidential text in notes if the folder itself is not trusted.

## Machine-local settings on a subscriber

While subscribed, machine-local settings live in `userData/local.db`, so replacing the workspace database never
loses them. These are `lang`, `theme`, `ui.*`, `team.*`, `notify.*`, `session.*`, `ai.*`, `app.*`,
`token:team:*` and `token:ai:*`. The shared copy itself is `userData/workspaces/<teamId>/data.db`.

## Roles

| Role | Where | Can |
|---|---|---|
| Admin | own install (default) | everything |
| Analyst | subscribers (default), or chosen on the own install | analytics, reports, notes, inbox status, planner; **not** setup, secrets, `settings` (except UI, language, theme and notifications), transfer, backup/restore, the publish worker or creating a team |
| Client | "Present to client" | only the chosen clients' accounts, analytics, report preview/export and notes marked *Visible to client* |

The role in `members/<id>.json` is informational. Each install decides its own role. A subscriber can never be admin.

### Present to client

**Settings → Team → Present to client**: pick one or more client names (the *Client* field on accounts) and a 4–8
digit PIN. Navigation hides Settings, Setup, Ask, Inbox, Planner, SQL, Competitors, Studio and Ads. Every account
list and every account/post id in a request is limited to those clients. Exiting needs the PIN. Five wrong PINs lock
the prompt for 30 seconds. The client view survives a restart.

## Notes and @mentions

Notes on accounts, posts and inbox comments show the author, time and a visibility chip (*Internal* or *Visible to
client*). Type `@` to pick a teammate. A handle typed by hand is also recognised. When someone mentions you, you get
a desktop notification (Settings → Notifications) and a Mentions badge in Settings → Team. Only the author or an
admin can edit or delete a note.

## Command line

```
metadash team status      # mode, team, last publish/pull, members
metadash team publish     # publisher: publish a snapshot now   (exit 6 on a subscriber)
metadash team pull        # subscriber: fetch the latest snapshot and events now
```

## Troubleshooting

- *"The snapshot is still syncing"*: wait for the sync client to finish, then check for updates again.
- *"Wrong team passphrase"*: the key check in `team.json` did not match. Nothing was changed.
- *"Published by a newer MetaDash"*: update MetaDash on this computer.
- Two publishers: only the install that created the team publishes. If another install creates a team in the same
  folder, it gets its own `<teamId>` folder.
