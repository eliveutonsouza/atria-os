# syntax=docker/dockerfile:1
FROM node:24-slim AS web
WORKDIR /app
COPY shared ./shared
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

FROM node:24-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl ripgrep procps openssh-client \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOME=/data/home \
    YUI_DATA_DIR=/data \
    YUI_WORKSPACE_DIR=/workspace \
    YUI_SEED_DIR=/app/workspace-seed \
    YUI_WEB_DIST=/app/web/dist \
    PORT=8080
WORKDIR /app
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/
COPY server/src ./server/src
COPY shared ./shared
COPY workspace-seed ./workspace-seed
COPY --from=web /app/web/dist ./web/dist
RUN mkdir -p /data/home /workspace && chown -R node:node /data /workspace
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fs http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/src/index.ts"]
