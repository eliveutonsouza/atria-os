#!/usr/bin/env bash
# Deploy do Yui Console sem matar trabalho em andamento:
# espera execuções/aprovações terminarem (até YUI_DRAIN_MIN minutos), rebuild, sobe e roda o e2e.
# Uso: ./scripts-deploy.sh [--force] [--no-e2e]
set -euo pipefail
cd "$(dirname "$0")"
FORCE=0; E2E=1
for a in "$@"; do case "$a" in --force) FORCE=1;; --no-e2e) E2E=0;; esac; done
PROJECT="${YUI_PROJECT:-$(sed -n 's/^YUI_PROJECT=//p' .env 2>/dev/null | tail -1)}"; PROJECT="${PROJECT:-yui-console}"
C="$PROJECT-yui-console-1"
busy() {
  docker exec "$C" node -e "const D=require('/app/server/node_modules/better-sqlite3');const db=new D('/data/yui.db',{readonly:true});console.log(db.prepare(\"SELECT COUNT(*) n FROM runs WHERE state IN ('running','waiting_approval')\").get().n)" 2>/dev/null || echo 0
}
if [ "$FORCE" = 0 ]; then
  for i in $(seq 1 $(( ${YUI_DRAIN_MIN:-20} * 4 ))); do
    n=$(busy); [ "$n" = 0 ] && break
    echo "aguardando $n execução(ões) terminarem…"; sleep 15
  done
fi
docker compose -p "$PROJECT" up -d --build
for i in $(seq 1 30); do
  st=$(docker inspect -f '{{.State.Health.Status}}' "$C" 2>/dev/null || echo starting)
  [ "$st" = healthy ] && break; sleep 3
done
echo "container: $st"
if [ "$E2E" = 1 ] && [ -f e2e/run.mjs ]; then
  [ -n "${YUI_E2E_PASSWORD:-}${YUI_E2E_SESSION:-}" ] || { echo "defina YUI_E2E_PASSWORD (ou YUI_E2E_SESSION)"; exit 1; }
  docker run --rm --network host -v "$PWD/e2e:/e2e" -w /e2e -e YUI_E2E_PASSWORD="${YUI_E2E_PASSWORD:-}" -e YUI_E2E_SESSION="${YUI_E2E_SESSION:-}" \
    mcr.microsoft.com/playwright:v1.63.0-noble bash -c "npm i -s playwright@1.63.0 >/dev/null 2>&1; node run.mjs && node mobile.mjs"
fi
