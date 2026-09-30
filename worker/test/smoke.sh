#!/usr/bin/env sh
# Docker smoke test (CI): build the image from the repository root, start it, wait for /v1/health, stop it.
set -eu
cd "$(dirname "$0")/../.."
IMAGE="${IMAGE:-metadash-worker:smoke}"
docker build -f worker/Dockerfile -t "$IMAGE" .
CID=$(docker run -d --rm -p 127.0.0.1:18787:8787 \
  -e MD_WORKER_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '\n')" \
  -e MD_WORKER_DATA_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')" "$IMAGE")
trap 'docker stop "$CID" >/dev/null 2>&1 || true' EXIT
i=0
until curl -fsS http://127.0.0.1:18787/v1/health; do
  i=$((i + 1)); [ "$i" -ge 30 ] && { docker logs "$CID"; exit 1; }; sleep 1
done
echo
# Signed routes must refuse unsigned requests.
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18787/v1/info)
[ "$code" = "400" ] || [ "$code" = "401" ] || { echo "unsigned /v1/info returned $code"; exit 1; }
echo "smoke ok"
