#!/usr/bin/env bash
# Atria OS — instalação por imagem pronta (GHCR), sem git nem build. Publicado em cada release.
# Normalmente vem dentro do comando gerado pelo Atria Central:
#   curl -fsSL https://<central>/i/<token> | sudo bash
# que grava /opt/atria-os/docker-compose.yml e /opt/atria-os/.env.central (endereço e chave do Central,
# ATRIA_TAG, GHCR_USER, GHCR_TOKEN, ATRIA_UPDATER_TOKEN) e então roda este script.
#
# Também roda sozinho, com as mesmas variáveis no ambiente:
#   sudo ATRIA_TAG=v1.0.0 GHCR_USER=… GHCR_TOKEN=… bash install-release.sh
#   sudo … bash install-release.sh --yes     # sem perguntas (respostas pelas variáveis abaixo)
#
# Variáveis: ATRIA_DIR (padrão /opt/atria-os) ATRIA_REGISTRY (padrão ghcr.io/eliveutonsouza) ATRIA_DOMAIN ACME_EMAIL ATRIA_PROXY=auto|traefik|caddy|none
#   ATRIA_HTTP_PORT (modo none) TZ OPENAI_API_KEY ATRIA_USER_NAME ATRIA_PROJECT ATRIA_OLD_DOMAIN (só Traefik)
#   ATRIA_TAG GHCR_USER GHCR_TOKEN ATRIA_MONITOR_URL ATRIA_MONITOR_KEY ATRIA_UPDATER_TOKEN
# Rodar de novo é seguro: mantém o .env (segredos e o que você editou) e sobe a versão de ATRIA_TAG.
set -euo pipefail
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null || true; exit 0 ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done
# Sem terminal (curl | bash em automação) não dá para perguntar.
[ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null || YES=1

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

ROOT="${ATRIA_DIR:-/opt/atria-os}"
ENV_FILE="$ROOT/.env"
CENTRAL_FILE="$ROOT/.env.central"
# Lê um valor de um arquivo KEY=VALUE (sem executar o arquivo).
file_get() { [ -f "$2" ] && sed -n "s/^$1=//p" "$2" | tail -1 | sed "s/^'\(.*\)'$/\1/; s/^\"\(.*\)\"$/\1/" || true; }
env_get() { file_get "$1" "$ENV_FILE"; }
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
# Grava KEY=VALUE só se a chave não existir ou estiver vazia (nunca sobrescreve o que você editou).
env_put() {
  local k="$1" v="$2"
  [ -z "$v" ] && return 0
  [ -n "$(env_get "$k")" ] && return 0
  env_set "$k" "$v"
}
rand() { openssl rand -hex "$1"; }
# Registro das imagens (outro só para testes/forks; o compose lê o mesmo ATRIA_REGISTRY do .env).
REGISTRY="${ATRIA_REGISTRY:-$(env_get ATRIA_REGISTRY)}"; REGISTRY="${REGISTRY:-ghcr.io/eliveutonsouza}"
REGISTRY_HOST="${REGISTRY%%/*}"

# ── 1. checagens e Docker ───────────────────────────────────────────────
say "1/5 servidor"
[ "$(id -u)" = 0 ] || die "rode como root (sudo)"
case "$(uname -m)" in x86_64|aarch64|arm64) ok "arquitetura $(uname -m)" ;; *) die "arquitetura $(uname -m) não suportada (x86_64 ou arm64)" ;; esac
missing=""
for c in curl openssl; do command -v "$c" >/dev/null || missing="$missing $c"; done
if [ -n "$missing" ]; then
  command -v apt-get >/dev/null || die "faltam:$missing (instale e rode de novo)"
  # shellcheck disable=SC2086 # lista de pacotes
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $missing ca-certificates >/dev/null
  ok "instalado:$missing"
fi
if ! command -v docker >/dev/null; then
  say "instalando o Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sh >/dev/null
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker compose version >/dev/null 2>&1 || die "falta o plugin docker compose v2 (apt install docker-compose-plugin)"
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) · compose $(docker compose version --short)"
mem=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
[ "$mem" -ge 7 ] && ok "RAM ${mem} GB" || warn "RAM ${mem} GB — recomendado 8 GB"
mkdir -p "$ROOT"
disk=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)
[ "${disk:-0}" -ge 20 ] && ok "disco livre ${disk} GB" || warn "disco livre ${disk} GB — recomendado ≥ 20 GB"
cd "$ROOT"

# ── 2. versão e acesso às imagens ───────────────────────────────────────
say "2/5 imagens"
# Ordem de prioridade: variável de ambiente > .env.central (do Atria Central) > .env já existente.
for k in ATRIA_TAG GHCR_USER GHCR_TOKEN ATRIA_MONITOR_URL ATRIA_MONITOR_KEY ATRIA_UPDATER_TOKEN; do
  [ -n "${!k:-}" ] && continue
  v="$(file_get "$k" "$CENTRAL_FILE")"; [ -n "$v" ] || v="$(env_get "$k")"
  printf -v "$k" '%s' "$v"
done
[ -n "$ATRIA_TAG" ] || die "defina ATRIA_TAG (ex.: v1.0.0) — o comando do Atria Central já traz"
case "$ATRIA_TAG" in v[0-9]*.[0-9]*.[0-9]*|latest) ;; *) die "ATRIA_TAG inválida: $ATRIA_TAG (use vX.Y.Z)" ;; esac
if [ -n "$GHCR_USER" ] && [ -n "$GHCR_TOKEN" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login "$REGISTRY_HOST" -u "$GHCR_USER" --password-stdin >/dev/null || die "login no $REGISTRY_HOST recusado (confira GHCR_USER/GHCR_TOKEN)"
  ok "login no $REGISTRY_HOST como $GHCR_USER"
else
  warn "sem GHCR_USER/GHCR_TOKEN: usando o login do Docker que já existir"
fi
UPDATER_IMAGE="$REGISTRY/atria-updater:$ATRIA_TAG"
docker pull -q "$UPDATER_IMAGE" >/dev/null || die "não consegui baixar $UPDATER_IMAGE"
# Arquivos do compose desta versão (navegador, Caddyfile, overrides) vêm dentro da imagem do atualizador.
cid="$(docker create "$UPDATER_IMAGE")"
docker cp -q "$cid:/app/stack/." "$ROOT/" && docker rm "$cid" >/dev/null
ok "arquivos da versão $ATRIA_TAG em $ROOT"

# ── 3. .env ─────────────────────────────────────────────────────────────
say "3/5 configuração (.env)"
FRESH=0
[ -f "$ENV_FILE" ] || { cp "$ROOT/.env.example" "$ENV_FILE"; FRESH=1; ok ".env criado"; }
chmod 600 "$ENV_FILE"
EXPLICIT_DOMAIN="${ATRIA_DOMAIN:-}"
ATRIA_DOMAIN="${ATRIA_DOMAIN:-$(env_get ATRIA_DOMAIN)}"
case "$ATRIA_DOMAIN" in atria.example.com) ATRIA_DOMAIN= ;; esac
ask ATRIA_DOMAIN "domínio do painel (DNS apontando para esta VPS), ex.: atria.seudominio.com"
[ -n "${ATRIA_DOMAIN:-}" ] || die "domínio obrigatório (com ATRIA_PROXY=none use o domínio que o seu proxy vai servir)"
TZ_HOST="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || true)"
# Instalação nova sugere o fuso da VPS; rodando de novo, mantém o do .env.
TZ_VAL="${TZ:-}"; TZ_DEF="$(env_get TZ)"
[ "$FRESH" = 1 ] && TZ_DEF="${TZ_HOST:-$TZ_DEF}"
ask TZ_VAL "fuso horário (hora da Yui, agenda e lembretes)" "${TZ_DEF:-America/Sao_Paulo}"
TZ_VAL="${TZ_VAL:-America/Sao_Paulo}"
[ -e "/usr/share/zoneinfo/$TZ_VAL" ] || [ ! -d /usr/share/zoneinfo ] || die "fuso inválido: $TZ_VAL (ex.: America/Sao_Paulo)"
ACME_EMAIL="${ACME_EMAIL:-$(env_get ACME_EMAIL)}"
ask ACME_EMAIL "e-mail para os certificados HTTPS (Let's Encrypt)"
OPENAI_API_KEY="${OPENAI_API_KEY:-$(env_get OPENAI_API_KEY)}"
ask OPENAI_API_KEY "chave da OpenAI (Enter = configurar depois no painel)"
PROJECT="${ATRIA_PROJECT:-$(env_get ATRIA_PROJECT)}"; PROJECT="${PROJECT:-atria-os}"
export ATRIA_PROJECT="$PROJECT"
C="$PROJECT-atria-1"

if [ -n "$EXPLICIT_DOMAIN" ] || [ "$(env_get ATRIA_DOMAIN)" = atria.example.com ]; then env_set ATRIA_DOMAIN "$ATRIA_DOMAIN"; fi
env_put ATRIA_DOMAIN "$ATRIA_DOMAIN"
env_set TZ "$TZ_VAL"
env_put ACME_EMAIL "${ACME_EMAIL:-}"
env_put OPENAI_API_KEY "${OPENAI_API_KEY:-}"
env_put ATRIA_USER_NAME "${ATRIA_USER_NAME:-}"
[ "$PROJECT" != atria-os ] && env_set ATRIA_PROJECT "$PROJECT"
# Versão, imagens e Atria Central: o que veio agora vale (o Central é a fonte).
env_set ATRIA_TAG "$ATRIA_TAG"
env_set GHCR_USER "$GHCR_USER"
env_set GHCR_TOKEN "$GHCR_TOKEN"
env_set ATRIA_MONITOR_URL "$ATRIA_MONITOR_URL"
env_set ATRIA_MONITOR_KEY "$ATRIA_MONITOR_KEY"
env_set ATRIA_UPDATER_TOKEN "$ATRIA_UPDATER_TOKEN"
env_put ATRIA_UPDATER_TOKEN "$(rand 32)"
env_set ATRIA_STACK_DIR "$ROOT"
[ "$REGISTRY" != ghcr.io/eliveutonsouza ] && env_set ATRIA_REGISTRY "$REGISTRY"
env_put SESSION_SECRET "$(rand 32)"
env_put ATRIA_PG_PASSWORD "$(rand 24)"
env_put ATRIA_QDRANT_KEY "$(rand 24)"
# O .env.central tem segredos e já foi copiado para o .env.
[ -f "$CENTRAL_FILE" ] && { shred -u "$CENTRAL_FILE" 2>/dev/null || rm -f "$CENTRAL_FILE"; }
ok ".env pronto (segredos aleatórios gerados; versão $ATRIA_TAG)"

# ── 4. proxy HTTPS ──────────────────────────────────────────────────────
say "4/5 proxy HTTPS"
ATRIA_PROXY="${ATRIA_PROXY:-$(env_get ATRIA_PROXY)}"; ATRIA_PROXY="${ATRIA_PROXY:-auto}"
if [ "$ATRIA_PROXY" != none ]; then
  ip=$(curl -fsS4 --max-time 5 https://api.ipify.org || true)
  r=$(getent ahostsv4 "$ATRIA_DOMAIN" | awk 'NR==1{print $1}' || true)
  if [ -n "$ip" ] && [ "$r" = "$ip" ]; then ok "$ATRIA_DOMAIN → $r"; else warn "$ATRIA_DOMAIN → ${r:-sem DNS} (esta VPS: ${ip:-?}) — sem o DNS certo o certificado HTTPS falha"; fi
fi
sed -i '/^COMPOSE_FILE=/d; /^COMPOSE_PROFILES=/d; /^ATRIA_TRAEFIK_ENABLE=/d' "$ENV_FILE"
if [ "$ATRIA_PROXY" = auto ]; then
  if docker ps --format '{{.Image}} {{.Names}}' | grep -qi traefik; then ATRIA_PROXY=traefik
  elif ss -ltn '( sport = :443 )' 2>/dev/null | grep -q LISTEN; then die "algo já usa a porta 443 e não é Traefik — libere a porta, ou use ATRIA_PROXY=none e aponte o seu proxy para o painel"
  else ATRIA_PROXY=caddy; fi
fi
# O profile "updater" liga o atualizador (atualização remota pelo Atria Central).
case "$ATRIA_PROXY" in
  traefik)
    env_set COMPOSE_PROFILES updater
    ok "usando o Traefik existente (labels: entrypoint ${ATRIA_TRAEFIK_ENTRYPOINT:-websecure}, resolver ${ATRIA_TRAEFIK_CERTRESOLVER:-letsencrypt})"
    ATRIA_OLD_DOMAIN="${ATRIA_OLD_DOMAIN:-$(env_get ATRIA_OLD_DOMAIN)}"
    if [ -n "$ATRIA_OLD_DOMAIN" ]; then
      env_set ATRIA_OLD_DOMAIN "$ATRIA_OLD_DOMAIN"
      env_set COMPOSE_FILE docker-compose.yml:docker-compose.redirect.yml
      ok "https://$ATRIA_OLD_DOMAIN redireciona para https://$ATRIA_DOMAIN"
    fi ;;
  caddy)
    [ -n "${ACME_EMAIL:-}" ] || die "o Caddy precisa de ACME_EMAIL para emitir o certificado"
    env_set COMPOSE_PROFILES edge,updater
    env_set ATRIA_TRAEFIK_ENABLE false
    ok "Caddy em :80/:443 com HTTPS automático" ;;
  none)
    env_set COMPOSE_PROFILES updater
    ATRIA_HTTP_PORT="${ATRIA_HTTP_PORT:-$(env_get ATRIA_HTTP_PORT)}"; ATRIA_HTTP_PORT="${ATRIA_HTTP_PORT:-8080}"
    env_set ATRIA_HTTP_PORT "$ATRIA_HTTP_PORT"
    env_set ATRIA_TRAEFIK_ENABLE false
    env_set COMPOSE_FILE docker-compose.yml:docker-compose.port.yml
    ok "sem proxy próprio: painel em 127.0.0.1:$ATRIA_HTTP_PORT (aponte o seu proxy HTTPS para cá)" ;;
  *) die "ATRIA_PROXY inválido: $ATRIA_PROXY (auto|traefik|caddy|none)" ;;
esac
env_set ATRIA_PROXY "$ATRIA_PROXY"

# ── 5. subir ────────────────────────────────────────────────────────────
say "5/5 download e subida (primeira vez leva alguns minutos)"
docker compose config -q || die "docker-compose.yml/.env inválidos — veja a mensagem acima"
docker compose pull -q
docker compose up -d --remove-orphans
s=starting
for _ in $(seq 1 60); do
  s=$(docker inspect -f '{{.State.Health.Status}}' "$C" 2>/dev/null || echo starting)
  [ "$s" = healthy ] && break; sleep 3
done
[ "$s" = healthy ] && ok "Atria OS $ATRIA_TAG saudável" || die "não ficou saudável — veja: cd $ROOT && docker compose logs atria"
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
  2. Em Configurações › Conexões: "Conectar conta Claude", GitHub (opcional) e a chave da OpenAI.
  3. Instale como app no celular/desktop e ative as notificações.
  Atualizações chegam pelo Atria Central (Configurações › Suporte e atualizações).
  Pasta da instalação: $ROOT
EOF
