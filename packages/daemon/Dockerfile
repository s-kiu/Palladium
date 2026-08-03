# syntax=docker/dockerfile:1
# pal-up panel image — Fastify daemon + compiled Angular UI.
# Build context is the REPO ROOT (it needs both packages):
#   docker build -f packages/daemon/Dockerfile -t pal-up/panel:dev .

# ── Stage 1: build the Angular panel ─────────────────────────────────────────
FROM node:22-alpine AS panel
WORKDIR /panel
COPY packages/panel/package*.json ./
RUN npm ci --no-audit --no-fund
COPY packages/panel/ ./
RUN npm run build

# ── Stage 2: compile the daemon ──────────────────────────────────────────────
FROM node:22-alpine AS daemon
WORKDIR /daemon
COPY packages/daemon/package*.json ./
RUN npm ci --no-audit --no-fund
COPY packages/daemon/ ./
RUN npm run build && npm ci --omit=dev --no-audit --no-fund

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine
# tar: used to create world backups on the shared volume
RUN apk add --no-cache tar
WORKDIR /app
COPY --from=daemon /daemon/dist ./dist
COPY --from=daemon /daemon/node_modules ./node_modules
COPY --from=daemon /daemon/package.json ./package.json
COPY --from=panel /panel/dist/panel/browser ./public

LABEL org.opencontainers.image.title="pal-up Panel" \
      org.opencontainers.image.description="Web panel for pal-up Palworld servers" \
      org.opencontainers.image.source="https://github.com/s-kiu/pal-up" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PANEL_PORT??3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "dist/server.js"]
