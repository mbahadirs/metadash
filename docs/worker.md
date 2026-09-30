# Self-hosted publish worker (optional)

[Türkçe](tr/worker.md)

MetaDash publishes scheduled posts from your computer (tray mode). If the computer sleeps or is off at the scheduled
time, the post is missed. The **worker** is a small, optional service you run yourself — on a VPS, a NAS or a
Raspberry Pi — that holds the queued posts you hand to it and publishes them on time to **Instagram, Facebook Pages
and Threads**. Nothing changes when you do not use it.

It is deliberately small: zero npm dependencies, a JSON state file, one HTTP port, no UI beyond `/v1/health`,
no analytics, no inbox, **no telemetry**.

> Naming: `src/main/worker/` in the app is the client for this service. `src/main/publishing/worker.js` is the
> unrelated local publishing queue of the desktop app.

## What the worker gets (and what it never gets)

| Sent to the worker | Never sent |
|---|---|
| Posts you set to *Publish via: Worker* (caption, first comment, format options, media files) | Analytics data, other posts, notes, clients |
| One publishing token per account: Meta user token for Instagram, the **Page token** for Facebook, the Threads token | Meta app secret, AI keys, Google/TikTok tokens, your Meta *user* token for Facebook |
| | Anything else in your database |

Tokens with permissions beyond publishing (ads, insights, comments, messaging …) are refused unless you tick
**Allow a broader token**. Best practice: create a dedicated token with only the publishing scopes
(`instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
`business_management`; Threads: `threads_basic`, `threads_content_publish`) and paste it in the token form.

## Quick start (Docker Compose)

1. In MetaDash: **Settings → Publishing → Self-hosted worker → Generate secret**. Save the snippet as `.env` on the
   worker host (it contains `MD_WORKER_SECRET` and `MD_WORKER_DATA_KEY`; the data key is shown only once).
2. Copy `worker/docker-compose.yml` (and `worker/Caddyfile.example` for HTTPS) next to the `.env`, then:

   ```sh
   docker compose up -d                   # worker on 127.0.0.1:8787 (use with Tailscale / SSH tunnel / LAN)
   docker compose --profile https up -d   # + Caddy with automatic HTTPS (set MD_DOMAIN and MD_PUBLIC_URL in .env)
   ```
3. Back in MetaDash, enter the worker address and the secret (or a pairing string `mdw1:…`) and press **Connect**.
   The desktop verifies the secret with a signed request before saving it.

   > **Only paste pairing strings from a worker you run yourself.** A pairing string is a credential: it decides
   > where MetaDash sends your publishing tokens. Before the first token is sent, MetaDash shows the decoded worker
   > address and asks you to confirm it, and it warns when the address is plain `http://` and not on this computer.
4. Send a token for every account the worker should publish to, then choose **Publish via → Worker** per post and
   account in the composer (or make the worker the default for new Meta posts).

### docker run

```sh
docker run -d --name metadash-worker --restart unless-stopped \
  --env-file .env -v metadash-worker:/data -p 127.0.0.1:8787:8787 \
  ghcr.io/mbahadirs/metadash-worker:latest
```

Build it yourself from a checkout (the image needs the repository root as context, it shares
`src/shared/publish` with the app):

```sh
docker build -f worker/Dockerfile -t metadash-worker .
```

Without Docker: Node.js 22+, then `MD_DATA_DIR=./data node worker/src/index.js` from the repository root (the
worker imports `../../src/shared/publish`).

### NAS and Raspberry Pi

The image is multi-arch (`linux/amd64`, `linux/arm64`). On Synology/QNAP use the container manager with the same
environment variables and a volume for `/data`. On a Raspberry Pi (64-bit OS) `docker compose up -d` works as is.
The worker needs very little: one Node process, a few MB of RAM plus the media files of queued posts (deleted
7 days after publishing).

## Network and TLS

The worker authenticates every request (HMAC, below), but HMAC does not hide content. **Use TLS whenever the worker
is not on a private network**:

- **Recommended:** keep the port private and reach it over **Tailscale / WireGuard** (URL like
  `http://worker.tailnet-name.ts.net:8787`). Nothing is exposed to the internet.
- **Public HTTPS:** the Compose `https` profile runs **Caddy** with automatic certificates. Set `MD_DOMAIN`
  and `MD_PUBLIC_URL=https://<domain>`. Any reverse proxy works if it **does not rewrite paths or query strings**
  (the signature covers them) and allows 110 MB request bodies.
- **Behind a proxy, set `MD_TRUST_PROXY=1`.** Otherwise every request seems to come from the proxy's address, so
  all clients share one rate limit, and 20 failed requests from anyone lock *everyone* out for 15 minutes. The
  Compose file sets it to `1` by default. The header is honoured only when the direct peer is a loopback or
  private-network address (your proxy), and MetaDash uses the right-most public address in it, so clients cannot
  pick their own address.

### Media URLs

Instagram images and all Threads media must be downloadable by Meta from a public HTTPS URL (VERIFY Meta's current
media-fetch requirements). Two options:

1. `MD_PUBLIC_URL` set: the worker serves uploaded files at signed, expiring links `GET /m/<sha256>?exp=…&sig=…`
   (24 h). Only those exact links work; everything else is 404.
2. No public URL: the desktop uses your media host from **Settings → Publishing** (S3-compatible storage etc.) when
   it hands the post over, and refuses to push posts that need a URL when no host is configured. Presigned URLs
   must still be valid at publishing time.

Facebook uploads and Instagram videos are uploaded by the worker directly (no public URL needed).

## Configuration

| Variable | Default | |
|---|---|---|
| `MD_WORKER_SECRET` | — (required, ≥ 32 chars) | shared secret from the pairing wizard |
| `MD_WORKER_DATA_KEY` | — (required, ≥ 32 chars) | encryption key for tokens at rest; never written to `/data` |
| `MD_PUBLIC_URL` | empty | public `https://` base URL for signed media links |
| `MD_DATA_DIR` | `/data` | state file + media |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `MD_STRICT_SCOPES` | `1` | re-check Instagram token scopes with Meta (`/me/permissions`) and token validity on receipt |
| `MD_TRUST_PROXY` | `0` (`1` in `docker-compose.yml`) | use `X-Forwarded-For` for rate limiting and lockout; required behind a reverse proxy. Honoured only from loopback/private-network peers |
| `MD_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `TZ` | container default | shown in `/v1/info` |

Every variable also accepts `<NAME>_FILE` (Docker secrets), e.g. `MD_WORKER_DATA_KEY_FILE=/run/secrets/md_data_key`.

## How it works

- The desktop owns **content**; the worker owns **execution state**. Each planner target has an `executor`
  (`local` | `worker`) and a `revision` that goes up on every edit or reschedule. The local tray publisher skips
  worker targets, so nothing is ever published twice.
- The desktop syncs every 2 minutes (and a few seconds after planner changes): it pushes targets whose revision is
  newer than the one the worker accepted and pulls status changes (`GET /v1/changes?since=<cursor>`).
- The worker ticks every 20 s. Containers are prepared 5 min (video: 20 min) before the scheduled time and published
  on time. Every step is saved before the next Meta call, so after a crash or restart it resumes; an item interrupted
  during the publish call is **recovered, never re-published** (IG/Threads container status → find the post).
- Transient errors back off 1, 2, 5, 10, 30 min (6 attempts); expired containers are rebuilt once; invalid tokens,
  missing permissions and rejected media fail at once. The IG daily publishing limit is checked before publishing.
- If the worker was down and an item is more than 6 hours late, it becomes **missed** instead of going out late.
  Use *Publish now* or *Reschedule* in the planner; the new revision goes back to the worker.
- **Recall**: switching a target back to *This computer* deletes it from the worker. Once the worker started
  publishing (container created) it answers 409 and the post stays with the worker.
- Threads tokens are refreshed on the worker when they expire within 20 days (the new expiry shows in Settings).
- Completed items are deleted after 30 days, media 7 days after publishing. **Disconnect** deletes every item,
  token and media file on the worker, then returns all targets to this computer.

### Protocol v1

All requests except `GET /v1/health` carry `X-MD-Protocol: 1`, `X-MD-Ts` (ms), `X-MD-Nonce` (16 random bytes) and
`X-MD-Sig = HMAC-SHA256(K_auth, METHOD \n PATH?QUERY \n TS \n NONCE \n SHA256(body))` with
`K_auth = HKDF(secret, 'mdw-auth-v1')`. Requests more than ±300 s off, replayed nonces and bad signatures are refused.

| Route | |
|---|---|
| `GET /v1/health` | unsigned: `{ok, protocol, version}` |
| `GET /v1/info` | version, time, tz, queue counts, public media URL flag, tokens (key, platform, expiry, validity, scopes) |
| `PUT /v1/tokens/:key` / `DELETE` | token envelope sealed with `K_tok = HKDF(secret, 'mdw-token-v1')` (AES-256-GCM, AAD = key) |
| `PUT /v1/media/:sha256` | raw bytes ≤ 100 MB, verified by hash |
| `POST /v1/items:batch` | upsert; accepted only when the revision is newer and the item has not started publishing |
| `DELETE /v1/items/:id?revision=` | recall; 409 once publishing |
| `GET /v1/changes?since=` | execution state changes after the cursor |
| `POST /v1/rotate` | new secret sealed with the current one |
| `POST /v1/reset` | delete everything (disconnect) |
| `GET /m/:sha256?exp&sig` | signed public media link (only with `MD_PUBLIC_URL`) |

Rate limit: 120 requests/min per client; 20 authentication failures in 10 min lock the client out for 15 min.

## Backups, rotation, upgrades

- **Backup** the `/data` volume (it holds `state.json` and media). Tokens inside are encrypted with
  `MD_WORKER_DATA_KEY`; keep that key in your password manager, not next to the backup. Without it, re-send the
  tokens from Settings (the queue itself is re-pushed by the desktop automatically).
- **Rotate the secret**: `metadash worker rotate` (CLI) sends a new secret sealed with the old one; the worker keeps
  it (encrypted) and the desktop switches after the worker confirmed. Put the printed `MD_WORKER_SECRET` into the
  worker `.env` when convenient. Rotating `MD_WORKER_DATA_KEY` = new key + re-send tokens.
- **Upgrade**: `docker compose pull && docker compose up -d`. The state file is versioned; the worker refuses to
  start on an unknown version instead of corrupting it.

## Threat model

| Threat | Mitigation |
|---|---|
| Someone on the network calls the API | HMAC on every route, nonce + timestamp window, rate limit and lockout |
| A pairing string from someone else redirects your tokens | the desktop shows the decoded address and asks before the first token push; warns on non-loopback `http://`; only pair with a worker you run |
| TLS-terminating proxy or network observer | tokens travel sealed with a key derived from the secret; use TLS/Tailscale for content |
| Stolen `/data` volume or backup | tokens encrypted at rest with `MD_WORKER_DATA_KEY` (not in `/data`) |
| Worker host fully compromised | attacker gets publishing tokens only (no user token for Facebook, no app secret, no analytics); revoke tokens in Meta and re-pair |
| Stale posts going out after an outage | items > 6 h late become *missed* |
| Double publishing | one executor per target; recall only before publishing; crash recovery never re-publishes |
| Guessing media URLs | content-addressed names + HMAC-signed expiring links, only with `MD_PUBLIC_URL` |
| Log leaks | logger redacts tokens, secrets, signatures, envelopes and bodies |
| Supply chain | zero npm dependencies; image built in CI from this repository, non-root (uid 10001), read-only root filesystem in Compose |

## Troubleshooting

- *The worker refused the request (secret)*: wrong secret, or clocks differ by more than 5 minutes (enable NTP).
- *Everyone is locked out after a few failed requests*: the worker runs behind a proxy without `MD_TRUST_PROXY=1`
  (see [Network and TLS](#network-and-tls)).
- *Unreachable*: check `docker compose ps`, the URL, and that Tailscale is up. `metadash worker test` from the CLI
  prints the round trip.
- *Needs public media URLs*: set `MD_PUBLIC_URL` (with HTTPS) or configure a media host in Settings → Publishing.
- CLI: `metadash worker status | sync | test | rotate`.
