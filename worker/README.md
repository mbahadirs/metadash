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

Build from the repository root (the worker shares `src/shared/publish` with the app):
`docker build -f worker/Dockerfile -t metadash-worker .` — smoke test: `sh worker/test/smoke.sh`.

Full guide (TLS, NAS / Raspberry Pi, backups, rotation, upgrading, threat model, protocol): [docs/worker.md](../docs/worker.md)
· Türkçe: [docs/tr/worker.md](../docs/tr/worker.md)
