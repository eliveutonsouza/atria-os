#!/usr/bin/env bash
# Yui Console — instalação numa VPS (Docker). Guia: docs/instalacao.md
#
#   sudo ./install.sh              # pergunta domínio e e-mail, gera .env, sobe tudo com HTTPS
#   sudo ./install.sh --yes        # sem perguntas (respostas por variável de ambiente, abaixo)
#   ./install.sh --env-only        # só gera/completa o .env (revise e rode de novo sem a flag)
#   sudo ./install.sh --update     # puxa a versão nova (git), espera execuções terminarem e reinicia
#   sudo ./install.sh --backup     # copia banco, workspace e logins para ./backups/
#
# Variáveis aceitas (instalação sem perguntas): YUI_DOMAIN ACME_EMAIL OPENAI_API_KEY YUI_USER_NAME
#   YUI_PROXY=auto|traefik|caddy (auto: usa o Traefik que já estiver rodando; senão sobe o Caddy)
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
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
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

ENV_FILE="$ROOT/.env"
# Valores passados explicitamente por variável de ambiente sobrescrevem o .env (os perguntados só preenchem vazios).
EXPLICIT_DOMAIN="${YUI_DOMAIN:-}"; EXPLICIT_EMAIL="${ACME_EMAIL:-}"; EXPLICIT_OPENAI="${OPENAI_API_KEY:-}"
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

C=yui-console-yui-console-1
busy_runs() {
  docker exec "$C" node -e "const D=require('/app/server/node_modules/better-sqlite3');const db=new D('/data/yui.db',{readonly:true});console.log(db.prepare(\"SELECT COUNT(*) n FROM runs WHERE state IN ('running','waiting_approval')\").get().n)" 2>/dev/null || echo 0
}
wait_healthy() {
  local s=starting
  for _ in $(seq 1 60); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$C" 2>/dev/null || echo starting)
    [ "$s" = healthy ] && break; sleep 3
  done
  [ "$s" = healthy ] && ok "Yui Console saudável" || die "não ficou saudável — veja: docker compose logs yui-console"
}

# ── backup ──────────────────────────────────────────────────────────────
if [ "$ACTION" = backup ]; then
  say "backup"
  mkdir -p "$ROOT/backups"
  out="backups/yui-$(date +%Y%m%d-%H%M).tgz"
  # banco + logins (yui-data) e projetos (yui-workspace); o banco é copiado com o .backup do SQLite para ficar consistente
  docker exec "$C" node -e "const D=require('/app/server/node_modules/better-sqlite3');new D('/data/yui.db').backup('/data/yui-backup.db').then(()=>console.log('ok'))" >/dev/null
  docker run --rm -v yui-console_yui-data:/data:ro -v yui-console_yui-workspace:/workspace:ro -v "$ROOT/backups:/out" alpine \
    tar czf "/out/$(basename "$out")" --exclude='data/yui.db' --exclude='data/yui.db-*' --exclude='workspace/*/node_modules' -C / data workspace
  docker exec "$C" rm -f /data/yui-backup.db
  cp "$ENV_FILE" "backups/env-$(date +%Y%m%d-%H%M)" && chmod 600 backups/env-*
  ok "salvo em $out (+ cópia do .env). Guarde fora da VPS."
  exit 0
fi

# ── update ──────────────────────────────────────────────────────────────
if [ "$ACTION" = update ]; then
  say "atualizar"
  if [ -d .git ] && git remote get-url origin >/dev/null 2>&1; then git pull --ff-only && ok "código atualizado ($(git log -1 --format=%h))"; else warn "sem git remoto — usando o código desta pasta"; fi
  for _ in $(seq 1 80); do n=$(busy_runs); [ "$n" = 0 ] && break; echo "  aguardando $n execução(ões) terminarem…"; sleep 15; done
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
[ "$mem" -ge 4 ] && ok "RAM ${mem} GB" || warn "RAM ${mem} GB — recomendado ≥ 4 GB (Yui 2 GB + navegador 1 GB)"
disk=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)
[ "${disk:-0}" -ge 15 ] && ok "disco livre ${disk} GB" || warn "disco livre ${disk} GB — recomendado ≥ 15 GB"

# ── 2. .env ─────────────────────────────────────────────────────────────
say "2/4 configuração (.env)"
[ -f "$ENV_FILE" ] || { cp .env.example "$ENV_FILE"; ok ".env criado a partir do .env.example"; }
chmod 600 "$ENV_FILE"
YUI_DOMAIN="${YUI_DOMAIN:-$(env_get YUI_DOMAIN)}"
[ "$YUI_DOMAIN" = yui.example.com ] && YUI_DOMAIN=
ask YUI_DOMAIN "domínio do painel (DNS apontando para esta VPS), ex.: yui.seudominio.com"
[ -n "${YUI_DOMAIN:-}" ] && [ "$YUI_DOMAIN" != "yui.example.com" ] || die "domínio obrigatório"
ACME_EMAIL="${ACME_EMAIL:-$(env_get ACME_EMAIL)}"
ask ACME_EMAIL "e-mail para os certificados HTTPS (Let's Encrypt)"
OPENAI_API_KEY="${OPENAI_API_KEY:-$(env_get OPENAI_API_KEY)}"
ask OPENAI_API_KEY "chave da OpenAI (voz e cérebro da Yui; Enter = configurar depois no painel)"
YUI_USER_NAME="${YUI_USER_NAME:-$(env_get YUI_USER_NAME)}"
# troca o exemplo pelo domínio real; valores passados explicitamente sempre valem
if [ -n "$EXPLICIT_DOMAIN" ] || [ "$(env_get YUI_DOMAIN)" = yui.example.com ]; then env_set YUI_DOMAIN "$YUI_DOMAIN"; fi
[ -n "$EXPLICIT_EMAIL" ] && env_set ACME_EMAIL "$EXPLICIT_EMAIL"
[ -n "$EXPLICIT_OPENAI" ] && env_set OPENAI_API_KEY "$EXPLICIT_OPENAI"
env_put YUI_DOMAIN "$YUI_DOMAIN"
env_put ACME_EMAIL "${ACME_EMAIL:-}"
env_put OPENAI_API_KEY "${OPENAI_API_KEY:-}"
env_put YUI_USER_NAME "${YUI_USER_NAME:-}"
env_put SESSION_SECRET "$(openssl rand -hex 32)"
ok ".env pronto ($(grep -cE '^[A-Z0-9_]+=.' "$ENV_FILE") valores preenchidos; segredos aleatórios gerados)"

# ── 3. proxy HTTPS ──────────────────────────────────────────────────────
say "3/4 proxy HTTPS"
ip=$(curl -fsS4 --max-time 5 https://api.ipify.org || true)
r=$(getent ahostsv4 "$YUI_DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -n "$ip" ] && [ "$r" = "$ip" ]; then ok "$YUI_DOMAIN → $r"; else warn "$YUI_DOMAIN → ${r:-sem DNS} (esta VPS: ${ip:-?}) — sem o DNS certo o certificado HTTPS falha"; fi
YUI_PROXY="${YUI_PROXY:-$(env_get YUI_PROXY)}"; YUI_PROXY="${YUI_PROXY:-auto}"
if [ "$YUI_PROXY" = auto ] && [ "$ENV_ONLY" = 0 ]; then
  if docker ps --format '{{.Image}} {{.Names}}' | grep -qi traefik; then YUI_PROXY=traefik
  elif ss -ltn '( sport = :443 )' 2>/dev/null | grep -q LISTEN; then die "algo já usa a porta 443 e não é Traefik — libere a porta ou rode com YUI_PROXY=traefik"
  else YUI_PROXY=caddy; fi
fi
case "$YUI_PROXY" in
  traefik)
    sed -i '/^COMPOSE_PROFILES=/d' "$ENV_FILE"
    ok "usando o Traefik existente (labels: entrypoint ${YUI_TRAEFIK_ENTRYPOINT:-websecure}, resolver ${YUI_TRAEFIK_CERTRESOLVER:-letsencrypt})" ;;
  caddy)
    [ -n "${ACME_EMAIL:-}" ] || die "o Caddy precisa de ACME_EMAIL para emitir o certificado"
    grep -q '^COMPOSE_PROFILES=' "$ENV_FILE" && sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=edge/' "$ENV_FILE" || echo 'COMPOSE_PROFILES=edge' >>"$ENV_FILE"
    ok "Caddy em :80/:443 com HTTPS automático" ;;
  auto) ok "proxy será detectado na instalação" ;;
  *) die "YUI_PROXY inválido: $YUI_PROXY (auto|traefik|caddy)" ;;
esac
env_set YUI_PROXY "$YUI_PROXY"

[ "$ENV_ONLY" = 1 ] && { say "pronto: revise $ENV_FILE e rode sudo ./install.sh"; exit 0; }

# ── 4. subir ────────────────────────────────────────────────────────────
say "4/4 build e subida (primeira vez leva alguns minutos)"
docker compose up -d --build
wait_healthy
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$YUI_DOMAIN/api/health" || true)
[ "$code" = 200 ] && ok "https://$YUI_DOMAIN respondendo" || warn "HTTPS ainda não respondeu ($code) — o certificado pode levar 1–2 min"

say "Yui Console instalado"
cat <<EOF
  Abra:  https://$YUI_DOMAIN
  1. No primeiro acesso você cria a sua senha.
  2. Em Configurações › Conexões: "Conectar conta Claude" (abre um terminal no próprio painel — digite /login),
     GitHub (opcional) e a chave da OpenAI (se não informou agora).
  3. Instale como app no celular/desktop e ative as notificações.
  Atualizar: sudo ./install.sh --update   ·   Backup: sudo ./install.sh --backup
EOF
