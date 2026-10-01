# syntax=docker/dockerfile:1
# Tenax signature service: API + admin console + Outlook add-in runtime in one image.

# ───── Build ─────
FROM node:22-bookworm-slim AS build
WORKDIR /src
# Toolchain in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY api/package.json api/package-lock.json api/
RUN cd api && npm ci
COPY admin/package.json admin/package-lock.json admin/
RUN cd admin && npm ci
COPY addin/package.json addin/package-lock.json addin/
RUN cd addin && npm ci

COPY api api
COPY admin admin
COPY addin addin
RUN cd addin && npm run build \
 && cd ../admin && npm run build \
 && cd ../api && npm run build && npm prune --omit=dev

# ───── Runtime ─────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8085 \
    DATA_DIR=/data
WORKDIR /app

COPY --from=build /src/api/package.json api/package.json
COPY --from=build /src/api/node_modules api/node_modules
COPY --from=build /src/api/dist api/dist
COPY --from=build /src/admin/dist admin/dist
COPY --from=build /src/addin/dist addin/dist
COPY addin/manifest.template.xml addin/manifest.template.xml
# Seed data: imported into the database on first launch only.
COPY config config
COPY templates templates
COPY assets assets
COPY fixtures fixtures

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8085
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8085/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "api/dist/server.js"]
