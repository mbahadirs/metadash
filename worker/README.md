# MetaDash worker

Optional self-hosted publish worker for [MetaDash](../README.md): publishes the Instagram, Facebook Page and Threads
posts you hand to it on time, even when your computer is off. Zero dependencies (Node.js 22), one JSON state file,
HMAC-authenticated API, tokens encrypted at rest, no telemetry.

```sh
# 1. MetaDash → Settings → Publishing → Self-hosted worker → Generate secret → save as .env here
# 2. start (private network / Tailscale):
docker compose up -d
#    or with automatic HTTPS (set MD_DOMAIN and MD_PUBLIC_URL in .env):
docker compose --profile https up -d
# 3. MetaDash → enter the worker address + secret → Connect → send tokens → "Publish via: Worker"
```

Behind a reverse proxy (the `https` profile's Caddy, or your own) the worker must run with `MD_TRUST_PROXY=1`, or
every client shares the proxy's address and one bad client can lock everyone out. `docker-compose.yml` sets it by
default (`MD_TRUST_PROXY=${MD_TRUST_PROXY:-1}`). `X-Forwarded-For` is honoured only when the connection comes from a
private/loopback address (the proxy), and the right-most public entry (the one the proxy appended) is used. Requests
without signature headers get 401 without counting toward the lockout, and `/v1/health` is never locked out.

Build from the repository root (the worker shares `src/shared/publish` with the app):
`docker build -f worker/Dockerfile -t metadash-worker .` — smoke test: `sh worker/test/smoke.sh`.

Full guide (TLS, NAS / Raspberry Pi, backups, rotation, upgrading, threat model, protocol): [docs/worker.md](../docs/worker.md)
· Türkçe: [docs/tr/worker.md](../docs/tr/worker.md)
