#!/usr/bin/env bash
# Deploy do Atria OS sem matar trabalho em andamento:
# espera execuções/aprovações terminarem (até ATRIA_DRAIN_MIN minutos), rebuild, sobe e roda o e2e.
# Uso: ./scripts-deploy.sh [--force] [--no-e2e]
set -euo pipefail
cd "$(dirname "$0")"
FORCE=0; E2E=1
for a in "$@"; do case "$a" in --force) FORCE=1;; --no-e2e) E2E=0;; esac; done
PROJECT="${ATRIA_PROJECT:-$(sed -n 's/^ATRIA_PROJECT=//p' .env 2>/dev/null | tail -1)}"; PROJECT="${PROJECT:-atria-os}"
C="$PROJECT-atria-1"
# Deploy a partir do código: soma o docker-compose.build.yml aos arquivos do .env (COMPOSE_FILE) para buildar aqui.
CF="${COMPOSE_FILE:-$(sed -n 's/^COMPOSE_FILE=//p' .env 2>/dev/null | tail -1)}"; CF="${CF:-docker-compose.yml}"
case ":$CF:" in *:docker-compose.build.yml:*) ;; *) CF="$CF:docker-compose.build.yml" ;; esac
export COMPOSE_FILE="$CF"
busy() {
  docker exec "$C" node -e "const D=require('/app/server/node_modules/better-sqlite3');const db=new D('/data/atria.db',{readonly:true});console.log(db.prepare(\"SELECT COUNT(*) n FROM runs WHERE state IN ('running','waiting_approval')\").get().n)" 2>/dev/null || echo 0
}
if [ "$FORCE" = 0 ]; then
  for i in $(seq 1 $(( ${ATRIA_DRAIN_MIN:-20} * 4 ))); do
    n=$(busy); [ "$n" = 0 ] && break
    echo "aguardando $n execução(ões) terminarem…"; sleep 15
  done
fi
ATRIA_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo dev)" docker compose -p "$PROJECT" up -d --build
for i in $(seq 1 30); do
  st=$(docker inspect -f '{{.State.Health.Status}}' "$C" 2>/dev/null || echo starting)
  [ "$st" = healthy ] && break; sleep 3
done
echo "container: $st"
if [ "$E2E" = 1 ] && [ -f e2e/run.mjs ]; then
  [ -n "${ATRIA_E2E_PASSWORD:-}${ATRIA_E2E_SESSION:-}" ] || { echo "defina ATRIA_E2E_PASSWORD (ou ATRIA_E2E_SESSION)"; exit 1; }
  docker run --rm --network host -v "$PWD/e2e:/e2e" -w /e2e -e ATRIA_E2E_PASSWORD="${ATRIA_E2E_PASSWORD:-}" -e ATRIA_E2E_SESSION="${ATRIA_E2E_SESSION:-}" \
    mcr.microsoft.com/playwright:v1.63.0-noble bash -c "npm i -s playwright@1.63.0 >/dev/null 2>&1; node run.mjs && node mobile.mjs"
fi
