#!/usr/bin/env bash
# Atria OS — instalação numa VPS (Docker). Guia: docs/instalacao.md
#
#   sudo ./install.sh              # pergunta domínio e e-mail, gera .env, sobe tudo com HTTPS
#   sudo ./install.sh --yes        # sem perguntas (respostas por variável de ambiente, abaixo)
#   ./install.sh --env-only        # só gera/completa o .env (revise e rode de novo sem a flag)
#   sudo ./install.sh --update     # puxa a versão nova (git), espera execuções terminarem e reinicia
#   sudo ./install.sh --backup     # copia banco, workspace e logins para ./backups/
#
# Variáveis aceitas (instalação sem perguntas): ATRIA_DOMAIN ACME_EMAIL OPENAI_API_KEY ATRIA_USER_NAME TZ
#   ATRIA_MONITOR_URL ATRIA_MONITOR_KEY (opcional: monitoramento remoto pelo Atria Central do administrador)
#   ATRIA_PROXY=auto|traefik|caddy|none (auto: usa o Traefik que já estiver rodando; senão sobe o Caddy;
#     none: sem HTTPS próprio, publica 127.0.0.1:ATRIA_HTTP_PORT para o seu proxy)
#   ATRIA_PROJECT (padrão atria-os; outro nome = segunda instalação isolada na mesma VPS)
#   ATRIA_OLD_DOMAIN (opcional, só com Traefik: domínio antigo que redireciona para ATRIA_DOMAIN)
#   Instalações de antes do nome Atria OS: YUI_* também são aceitas, e o .env/volumes antigos são migrados.
# Depois de subir: abra https://<domínio>, crie a senha no primeiro acesso e conecte Claude/GitHub/OpenAI
# em Configurações › Conexões (tudo pelo painel, inclusive o login da conta Claude).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
YES=0; ENV_ONLY=0; ACTION=install
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --env-only) ENV_ONLY=1 ;;
    --update) ACTION=update ;;
    --backup) ACTION=backup ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask() { # ask VAR "pergunta" [padrão]
  local var="$1" q="$2" def="${3:-}" cur="${!1:-}"
  [ -n "$cur" ] && return 0
  if [ "$YES" = 1 ]; then printf -v "$var" '%s' "$def"; return 0; fi
  read -r -p "  $q${def:+ [$def]}: " cur </dev/tty || true
  printf -v "$var" '%s' "${cur:-$def}"
}

# Variáveis YUI_* (instalações de antes do nome Atria OS) valem como ATRIA_* quando a nova não foi passada.
for v in $(compgen -e | grep '^YUI_' || true); do n="ATRIA_${v#YUI_}"; [ -n "${!n:-}" ] || export "$n=${!v}"; done

ENV_FILE="$ROOT/.env"
# Valores passados explicitamente por variável de ambiente sobrescrevem o .env (os perguntados só preenchem vazios).
EXPLICIT_DOMAIN="${ATRIA_DOMAIN:-}"; EXPLICIT_EMAIL="${ACME_EMAIL:-}"; EXPLICIT_OPENAI="${OPENAI_API_KEY:-}"
EXPLICIT_MONITOR_URL="${ATRIA_MONITOR_URL:-}"; EXPLICIT_MONITOR_KEY="${ATRIA_MONITOR_KEY:-}"
# Lê um valor do .env (sem executar o arquivo).
env_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed "s/^'\(.*\)'$/\1/" || true; }
# Grava KEY=VALUE no .env só se a chave não existir ou estiver vazia (idempotente; nunca sobrescreve o que você editou).
# Grava KEY=VALUE sempre (sobrescreve).
env_set() {
  local k="$1" v="$2"
  [ -z "$v" ] && return 0
  if grep -qE "^$k=" "$ENV_FILE" 2>/dev/null; then
    local tmp; tmp="$(mktemp)"; awk -v k="$k" -v v="$v" -F= '$1==k{print k"="v; next} {print}' "$ENV_FILE" >"$tmp" && cat "$tmp" >"$ENV_FILE" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$k" "$v" >>"$ENV_FILE"
  fi
}
env_put() {
  local k="$1" v="$2"
  [ -z "$v" ] && return 0
  if grep -qE "^$k=" "$ENV_FILE" 2>/dev/null; then
    [ -n "$(env_get "$k")" ] && return 0
    local tmp; tmp="$(mktemp)"; awk -v k="$k" -v v="$v" -F= '$1==k{print k"="v; next} {print}' "$ENV_FILE" >"$tmp" && cat "$tmp" >"$ENV_FILE" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$k" "$v" >>"$ENV_FILE"
  fi
}

# .env de antes do Atria OS: cada YUI_X=v sem ATRIA_X ganha ATRIA_X=v no fim (as linhas YUI_ ficam intactas).
migrate_env() {
  [ -f "$ENV_FILE" ] || return 0
  local line k n=0
  while IFS= read -r line; do
    k="${line%%=*}"
    grep -qE "^ATRIA_${k#YUI_}=" "$ENV_FILE" && continue
    printf 'ATRIA_%s\n' "${line#YUI_}" >>"$ENV_FILE"; n=$((n + 1))
  done < <(grep -E '^YUI_[A-Z0-9_]+=' "$ENV_FILE" || true)
  [ "$n" = 0 ] || ok ".env: $n variável(is) YUI_ copiada(s) para ATRIA_"
}
migrate_env

# Nome do projeto compose (containers, volumes, imagens). Fica gravado no .env quando não é o padrão.
PROJECT="${ATRIA_PROJECT:-$(env_get ATRIA_PROJECT)}"; PROJECT="${PROJECT:-atria-os}"
export ATRIA_PROJECT="$PROJECT"
C="$PROJECT-atria-1"
# versão do build (aparece no Atria Central); sem git fica "dev"
atria_version() { export ATRIA_VERSION; ATRIA_VERSION="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)"; }
# Instalação de antes do Atria OS (volumes <projeto>_yui-data…): espera as execuções, para os containers
# antigos e copia cada volume para o nome novo, uma vez. Os volumes antigos ficam intactos para rollback.
LEGACY_PROJECT="$(env_get YUI_PROJECT)"; LEGACY_PROJECT="${LEGACY_PROJECT:-yui-console}"
migrate_volumes() {
  docker volume inspect "${LEGACY_PROJECT}_yui-data" >/dev/null 2>&1 || return 0
  docker volume inspect "${PROJECT}_data" >/dev/null 2>&1 && return 0
  say "migrando a instalação antiga ($LEGACY_PROJECT → $PROJECT)"
  local old="$LEGACY_PROJECT-yui-console-1" n pair from to
  for _ in $(seq 1 80); do
    n=$(docker exec "$old" node -e "const D=require('/app/server/node_modules/better-sqlite3');const db=new D('/data/yui.db',{readonly:true});console.log(db.prepare(\"SELECT COUNT(*) n FROM runs WHERE state IN ('running','waiting_approval')\").get().n)" 2>/dev/null || echo 0)
    [ "$n" = 0 ] && break; echo "  aguardando $n execução(ões) terminarem…"; sleep 15
  done
  for c in $(docker ps -aq --filter "label=com.docker.compose.project=$LEGACY_PROJECT"); do docker stop "$c" >/dev/null; docker rm "$c" >/dev/null; done
  [ "$LEGACY_PROJECT" = "$PROJECT" ] || docker network rm "${LEGACY_PROJECT}_default" >/dev/null 2>&1 || true
  ok "containers antigos parados"
  for pair in yui-data:data yui-workspace:workspace yui-pg:pg yui-qdrant:qdrant yui-browser-profile:browser-profile yui-caddy-data:caddy-data yui-caddy-config:caddy-config; do
    from="${LEGACY_PROJECT}_${pair%%:*}"; to="${PROJECT}_${pair#*:}"
    docker volume inspect "$from" >/dev/null 2>&1 || continue
    docker volume create --label "com.docker.compose.project=$PROJECT" --label "com.docker.compose.volume=${pair#*:}" "$to" >/dev/null
    docker run --rm -v "$from:/from:ro" -v "$to:/to" alpine sh -c 'cp -a /from/. /to/'
    ok "$from → $to"
  done
  warn "volumes antigos (${LEGACY_PROJECT}_yui-*) mantidos para rollback; apague-os depois de conferir"
}
# Instalação a partir do código: o docker-compose.build.yml builda aqui (sem ele o compose puxaria as imagens do GHCR).
ensure_build_override() {
  local cf; cf="$(env_get COMPOSE_FILE)"; cf="${cf:-docker-compose.yml}"
  case ":$cf:" in *:docker-compose.build.yml:*) ;; *) env_set COMPOSE_FILE "$cf:docker-compose.build.yml" ;; esac
}
busy_runs() {
  docker exec "$C" node -e "const D=require('/app/server/node_modules/better-sqlite3');const db=new D('/data/atria.db',{readonly:true});console.log(db.prepare(\"SELECT COUNT(*) n FROM runs WHERE state IN ('running','waiting_approval')\").get().n)" 2>/dev/null || echo 0
}
wait_healthy() {
  local s=starting
  for _ in $(seq 1 60); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$C" 2>/dev/null || echo starting)
    [ "$s" = healthy ] && break; sleep 3
  done
  [ "$s" = healthy ] && ok "Atria OS saudável" || die "não ficou saudável — veja: docker compose logs atria"
}

# ── backup ──────────────────────────────────────────────────────────────
if [ "$ACTION" = backup ]; then
  say "backup"
  mkdir -p "$ROOT/backups"
  out="backups/atria-$(date +%Y%m%d-%H%M).tgz"
  # banco + logins (data) e projetos (workspace); o banco é copiado com o .backup do SQLite para ficar consistente
  docker exec "$C" node -e "const D=require('/app/server/node_modules/better-sqlite3');new D('/data/atria.db').backup('/data/atria-backup.db').then(()=>console.log('ok'))" >/dev/null
  # base da Empresa: dump do Postgres (arquivo ao lado) e vetores do Qdrant (dentro do .tgz)
  if docker ps --format '{{.Names}}' | grep -qx "$PROJECT-atria-postgres-1"; then
    docker exec "$PROJECT-atria-postgres-1" pg_dump -U yui -d yui -Fc >"${out%.tgz}-empresa.pgdump"
  fi
  docker run --rm -v "${PROJECT}_data:/data:ro" -v "${PROJECT}_workspace:/workspace:ro" -v "${PROJECT}_qdrant:/qdrant:ro" -v "$ROOT/backups:/out" alpine \
    tar czf "/out/$(basename "$out")" --exclude='data/atria.db' --exclude='data/atria.db-*' --exclude='workspace/*/node_modules' -C / data workspace qdrant
  docker exec "$C" rm -f /data/atria-backup.db
  cp "$ENV_FILE" "backups/env-$(date +%Y%m%d-%H%M)" && chmod 600 backups/env-*
  ok "salvo em $out (+ ${out%.tgz}-empresa.pgdump e cópia do .env). Guarde fora da VPS."
  exit 0
fi

# ── update ──────────────────────────────────────────────────────────────
if [ "$ACTION" = update ]; then
  say "atualizar"
  if [ -d .git ] && git remote get-url origin >/dev/null 2>&1; then git pull --ff-only && ok "código atualizado ($(git log -1 --format=%h))"; else warn "sem git remoto — usando o código desta pasta"; fi
  migrate_volumes
  ensure_build_override
  for _ in $(seq 1 80); do n=$(busy_runs); [ "$n" = 0 ] && break; echo "  aguardando $n execução(ões) terminarem…"; sleep 15; done
  atria_version
  docker compose up -d --build
  wait_healthy
  exit 0
fi

# ── 1. checagens ────────────────────────────────────────────────────────
say "1/4 checagens do servidor"
[ "$ENV_ONLY" = 1 ] || [ "$(id -u)" = 0 ] || die "rode como root (sudo ./install.sh)"
for c in openssl curl; do command -v "$c" >/dev/null || die "falta $c (apt install $c)"; done
if [ "$ENV_ONLY" = 0 ]; then
  command -v docker >/dev/null || die "falta o Docker: https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || die "falta o plugin docker compose v2"
  ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) · compose $(docker compose version --short)"
fi
mem=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
[ "$mem" -ge 7 ] && ok "RAM ${mem} GB" || warn "RAM ${mem} GB — recomendado 8 GB (Atria OS 2 + leitor de documentos 3 + navegador 1 + VS Code 1,5 GB, nos picos)"
disk=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)
[ "${disk:-0}" -ge 20 ] && ok "disco livre ${disk} GB" || warn "disco livre ${disk} GB — recomendado ≥ 20 GB"
case "$(uname -m)" in x86_64|aarch64|arm64) ok "arquitetura $(uname -m)" ;; *) die "arquitetura $(uname -m) não suportada (x86_64 ou arm64)" ;; esac

# ── 2. .env ─────────────────────────────────────────────────────────────
say "2/4 configuração (.env)"
[ -f "$ENV_FILE" ] || { cp .env.example "$ENV_FILE"; ok ".env criado a partir do .env.example"; }
chmod 600 "$ENV_FILE"
ATRIA_DOMAIN="${ATRIA_DOMAIN:-$(env_get ATRIA_DOMAIN)}"
case "$ATRIA_DOMAIN" in atria.example.com|yui.example.com) ATRIA_DOMAIN= ;; esac
ask ATRIA_DOMAIN "domínio do painel (DNS apontando para esta VPS), ex.: atria.seudominio.com"
[ -n "${ATRIA_DOMAIN:-}" ] || die "domínio obrigatório (com ATRIA_PROXY=none use o domínio que o seu proxy vai servir)"
TZ_HOST="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || true)"
TZ_VAL="${TZ:-$(env_get TZ)}"
[ -n "$TZ_VAL" ] || ask TZ_VAL "fuso horário (a Yui usa para hora, agenda e lembretes)" "${TZ_HOST:-America/Sao_Paulo}"
TZ_VAL="${TZ_VAL:-America/Sao_Paulo}"
[ -e "/usr/share/zoneinfo/$TZ_VAL" ] || [ ! -d /usr/share/zoneinfo ] || die "fuso inválido: $TZ_VAL (ex.: America/Sao_Paulo)"
ACME_EMAIL="${ACME_EMAIL:-$(env_get ACME_EMAIL)}"
ask ACME_EMAIL "e-mail para os certificados HTTPS (Let's Encrypt)"
OPENAI_API_KEY="${OPENAI_API_KEY:-$(env_get OPENAI_API_KEY)}"
ask OPENAI_API_KEY "chave da OpenAI (voz e cérebro da Yui; Enter = configurar depois no painel)"
ATRIA_USER_NAME="${ATRIA_USER_NAME:-$(env_get ATRIA_USER_NAME)}"
# monitoramento remoto (opcional): endereço e chave gerados no Atria Central do administrador
ATRIA_MONITOR_URL="${ATRIA_MONITOR_URL:-$(env_get ATRIA_MONITOR_URL)}"
ask ATRIA_MONITOR_URL "endereço do Atria Central (opcional; Enter = sem monitoramento remoto)"
if [ -n "${ATRIA_MONITOR_URL:-}" ]; then
  case "$ATRIA_MONITOR_URL" in https://*) ;; *) die "o endereço do Atria Central precisa começar com https://" ;; esac
  ATRIA_MONITOR_KEY="${ATRIA_MONITOR_KEY:-$(env_get ATRIA_MONITOR_KEY)}"
  ask ATRIA_MONITOR_KEY "chave desta instalação no Atria Central (atk_…)"
fi
# troca o exemplo pelo domínio real; valores passados explicitamente sempre valem
if [ -n "$EXPLICIT_DOMAIN" ] || [ "$(env_get ATRIA_DOMAIN)" = atria.example.com ] || [ "$(env_get ATRIA_DOMAIN)" = yui.example.com ]; then env_set ATRIA_DOMAIN "$ATRIA_DOMAIN"; fi
[ -n "$EXPLICIT_EMAIL" ] && env_set ACME_EMAIL "$EXPLICIT_EMAIL"
[ -n "$EXPLICIT_OPENAI" ] && env_set OPENAI_API_KEY "$EXPLICIT_OPENAI"
[ -n "$EXPLICIT_MONITOR_URL" ] && env_set ATRIA_MONITOR_URL "$EXPLICIT_MONITOR_URL"
[ -n "$EXPLICIT_MONITOR_KEY" ] && env_set ATRIA_MONITOR_KEY "$EXPLICIT_MONITOR_KEY"
env_put ATRIA_DOMAIN "$ATRIA_DOMAIN"
env_put ACME_EMAIL "${ACME_EMAIL:-}"
env_put OPENAI_API_KEY "${OPENAI_API_KEY:-}"
env_put ATRIA_USER_NAME "${ATRIA_USER_NAME:-}"
env_put ATRIA_MONITOR_URL "${ATRIA_MONITOR_URL:-}"
env_put ATRIA_MONITOR_KEY "${ATRIA_MONITOR_KEY:-}"
env_put TZ "$TZ_VAL"
[ "$PROJECT" != atria-os ] && env_set ATRIA_PROJECT "$PROJECT"
env_put SESSION_SECRET "$(openssl rand -hex 32)"
env_put ATRIA_PG_PASSWORD "$(openssl rand -hex 24)"
env_put ATRIA_QDRANT_KEY "$(openssl rand -hex 24)"
ok ".env pronto ($(grep -cE '^[A-Z0-9_]+=.' "$ENV_FILE") valores preenchidos; segredos aleatórios gerados)"

# ── 3. proxy HTTPS ──────────────────────────────────────────────────────
say "3/4 proxy HTTPS"
ip=$(curl -fsS4 --max-time 5 https://api.ipify.org || true)
r=$(getent ahostsv4 "$ATRIA_DOMAIN" | awk 'NR==1{print $1}' || true)
ATRIA_PROXY="${ATRIA_PROXY:-$(env_get ATRIA_PROXY)}"; ATRIA_PROXY="${ATRIA_PROXY:-auto}"
if [ "$ATRIA_PROXY" != none ]; then
  if [ -n "$ip" ] && [ "$r" = "$ip" ]; then ok "$ATRIA_DOMAIN → $r"; else warn "$ATRIA_DOMAIN → ${r:-sem DNS} (esta VPS: ${ip:-?}) — sem o DNS certo o certificado HTTPS falha"; fi
fi
# remove o override de porta; o modo none coloca de volta
sed -i '/^COMPOSE_FILE=/d; /^ATRIA_TRAEFIK_ENABLE=/d' "$ENV_FILE"
if [ "$ATRIA_PROXY" = auto ] && [ "$ENV_ONLY" = 0 ]; then
  if docker ps --format '{{.Image}} {{.Names}}' | grep -qi traefik; then ATRIA_PROXY=traefik
  elif ss -ltn '( sport = :443 )' 2>/dev/null | grep -q LISTEN; then die "algo já usa a porta 443 e não é Traefik — libere a porta, ou use ATRIA_PROXY=none e aponte o seu proxy para o painel"
  else ATRIA_PROXY=caddy; fi
fi
case "$ATRIA_PROXY" in
  traefik)
    sed -i '/^COMPOSE_PROFILES=/d' "$ENV_FILE"
    ok "usando o Traefik existente (labels: entrypoint ${ATRIA_TRAEFIK_ENTRYPOINT:-websecure}, resolver ${ATRIA_TRAEFIK_CERTRESOLVER:-letsencrypt})"
    ATRIA_OLD_DOMAIN="${ATRIA_OLD_DOMAIN:-$(env_get ATRIA_OLD_DOMAIN)}"
    if [ -n "$ATRIA_OLD_DOMAIN" ]; then
      env_set ATRIA_OLD_DOMAIN "$ATRIA_OLD_DOMAIN"
      env_set COMPOSE_FILE docker-compose.yml:docker-compose.redirect.yml
      ok "https://$ATRIA_OLD_DOMAIN redireciona para https://$ATRIA_DOMAIN"
    fi ;;
  caddy)
    [ -n "${ACME_EMAIL:-}" ] || die "o Caddy precisa de ACME_EMAIL para emitir o certificado"
    grep -q '^COMPOSE_PROFILES=' "$ENV_FILE" && sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=edge/' "$ENV_FILE" || echo 'COMPOSE_PROFILES=edge' >>"$ENV_FILE"
    env_set ATRIA_TRAEFIK_ENABLE false
    ok "Caddy em :80/:443 com HTTPS automático" ;;
  none)
    sed -i '/^COMPOSE_PROFILES=/d' "$ENV_FILE"
    ATRIA_HTTP_PORT="${ATRIA_HTTP_PORT:-$(env_get ATRIA_HTTP_PORT)}"; ATRIA_HTTP_PORT="${ATRIA_HTTP_PORT:-8080}"
    env_set ATRIA_HTTP_PORT "$ATRIA_HTTP_PORT"
    env_set ATRIA_TRAEFIK_ENABLE false
    env_set COMPOSE_FILE docker-compose.yml:docker-compose.port.yml
    ok "sem proxy próprio: painel em 127.0.0.1:$ATRIA_HTTP_PORT (aponte o seu proxy HTTPS para cá)" ;;
  auto) ok "proxy será detectado na instalação" ;;
  *) die "ATRIA_PROXY inválido: $ATRIA_PROXY (auto|traefik|caddy|none)" ;;
esac
env_set ATRIA_PROXY "$ATRIA_PROXY"
ensure_build_override

[ "$ENV_ONLY" = 1 ] && { say "pronto: revise $ENV_FILE e rode sudo ./install.sh"; exit 0; }

# ── 4. subir ────────────────────────────────────────────────────────────
migrate_volumes
say "4/4 build e subida (primeira vez leva alguns minutos)"
atria_version
docker compose up -d --build
wait_healthy
if [ "$ATRIA_PROXY" = none ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$ATRIA_HTTP_PORT/api/health" || true)
  [ "$code" = 200 ] && ok "http://127.0.0.1:$ATRIA_HTTP_PORT respondendo" || warn "porta $ATRIA_HTTP_PORT ainda não respondeu ($code)"
  warn "configure o seu proxy: https://$ATRIA_DOMAIN → http://127.0.0.1:$ATRIA_HTTP_PORT (sem buffer: SSE e WebSocket)"
else
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$ATRIA_DOMAIN/api/health" || true)
  [ "$code" = 200 ] && ok "https://$ATRIA_DOMAIN respondendo" || warn "HTTPS ainda não respondeu ($code) — o certificado pode levar 1–2 min"
fi

say "Atria OS instalado"
cat <<EOF
  Abra:  https://$ATRIA_DOMAIN
  1. No primeiro acesso você cria a sua senha.
  2. Em Configurações › Conexões: "Conectar conta Claude" (abre um terminal no próprio painel — digite /login),
     GitHub (opcional) e a chave da OpenAI (se não informou agora).
  3. Instale como app no celular/desktop e ative as notificações.
  Atualizar: sudo ./install.sh --update   ·   Backup: sudo ./install.sh --backup
EOF
