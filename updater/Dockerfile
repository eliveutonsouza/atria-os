# syntax=docker/dockerfile:1
# atria-updater: Node 24 (TS direto, sem dependências) + docker CLI e plugin compose da imagem oficial.
# Contexto = raiz do repo: a imagem também leva os arquivos do compose desta versão (/app/stack), que o
# deploy/install-release.sh copia na instalação e o próprio atualizador grava a cada atualização (Caddyfile, overrides).
# O navegador não entra mais aqui: tem imagem própria (atria-browser).
FROM docker:28.5.2-cli AS docker

FROM node:24-slim
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
ARG ATRIA_VERSION=dev
ENV ATRIA_VERSION=$ATRIA_VERSION \
    NODE_ENV=production \
    PORT=8787 \
    ATRIA_UPDATER_STATE=/state/updater.json
WORKDIR /app
COPY updater/package.json ./
COPY updater/src ./src
COPY docker-compose.yml docker-compose.port.yml docker-compose.redirect.yml Caddyfile .env.example ./stack/
RUN mkdir -p /state
# root de propósito: precisa do socket do Docker para recriar os serviços (nunca expõe porta pública).
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/index.ts"]
