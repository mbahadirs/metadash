# MetaDash self-hosted publish worker. Build from the REPOSITORY ROOT (the worker shares src/shared/publish with the app):
#   docker build -f worker/Dockerfile -t metadash-worker .
# Multi-arch images (amd64/arm64) are published to ghcr.io/mbahadirs/metadash-worker by .github/workflows/worker-image.yml.
FROM node:22-alpine

LABEL org.opencontainers.image.title="metadash-worker" \
      org.opencontainers.image.description="Optional self-hosted publish worker for MetaDash (Instagram, Facebook Pages, Threads)" \
      org.opencontainers.image.source="https://github.com/mbahadirs/metadash" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    MD_DATA_DIR=/data \
    PORT=8787 \
    HOST=0.0.0.0

WORKDIR /app
# Same relative layout as the repository: worker/src imports ../../src/shared/publish.
COPY worker/package.json worker/package.json
COPY worker/src worker/src
COPY src/shared/publish src/shared/publish
RUN echo '{"type":"module","private":true}' > /app/package.json \
 && addgroup -S -g 10001 metadash && adduser -S -D -H -u 10001 -G metadash metadash \
 && mkdir -p /data && chown 10001:10001 /data && chmod 700 /data

USER 10001:10001
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/worker
CMD ["node", "src/index.js"]
