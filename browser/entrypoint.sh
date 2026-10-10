#!/bin/sh
# Sidecar do navegador dos agentes: Chrome (Chromium no arm64) COM tela virtual (Xvfb), não headless, com CDP
# (9222 local; exposto em 9223 pelo cdp-proxy.mjs, assistível ao vivo pelo Atria OS) + Playwright MCP (porta 8931)
# conectado a ESSE navegador via --cdp-endpoint. Assim o que os agentes fazem pelo MCP aparece no screencast da página Navegador.
# Nada de alterar User-Agent ou impressão digital: é o navegador normal, só que numa tela virtual.
set -eu
if [ -x /opt/google/chrome/chrome ]; then
  CHROME=/opt/google/chrome/chrome
  POLICY_DIR=/etc/opt/chrome/policies/managed
else
  for CHROME in /ms-playwright/chromium-*/chrome-linux*/chrome; do break; done
  POLICY_DIR=/etc/chromium/policies/managed
fi
mkdir -p /profile /workspace/.atria/browser 2>/dev/null || true
# Este sidecar roda como root; o Atria OS roda como node (uid 1000) e precisa escrever em /workspace/.atria.
# Em volume novo o mkdir acima criaria tudo como root e o Atria OS morreria com EACCES no seed.
chown 1000:1000 /workspace /workspace/.atria /workspace/.atria/browser 2>/dev/null || true
rm -f /profile/SingletonLock /profile/SingletonSocket /profile/SingletonCookie /tmp/.X99-lock

# Experimental: extensão "Claude" (Claude in Chrome) instalada pela política gerenciada do navegador,
# direto da Chrome Web Store. Sem a env, a política sai e o navegador remove a extensão.
CLAUDE_EXT_ID=${ATRIA_BROWSER_CLAUDE_EXTENSION_ID:-fcoeoabgfenejglbffodgkkbkcdhcgfn}
if [ "${ATRIA_BROWSER_CLAUDE_EXTENSION:-0}" = "1" ]; then
  case "$CLAUDE_EXT_ID" in
    *[!a-p]*) echo "ATRIA_BROWSER_CLAUDE_EXTENSION_ID inválido: $CLAUDE_EXT_ID" >&2; exit 1 ;;
  esac
  [ "${#CLAUDE_EXT_ID}" -eq 32 ] || { echo "ATRIA_BROWSER_CLAUDE_EXTENSION_ID inválido: $CLAUDE_EXT_ID" >&2; exit 1; }
  mkdir -p "$POLICY_DIR"
  printf '{"ExtensionInstallForcelist":["%s;https://clients2.google.com/service/update2/crx"]}\n' "$CLAUDE_EXT_ID" > "$POLICY_DIR/atria.json"
  echo "extensão Claude ligada ($CLAUDE_EXT_ID)"
else
  rm -f "$POLICY_DIR/atria.json"
fi

export DISPLAY=:99
start_xvfb() {
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
  Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
  XVFB_PID=$!
  for _ in $(seq 1 40); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.25; done
}

start_chrome() {
  rm -f /profile/SingletonLock /profile/SingletonSocket /profile/SingletonCookie
  "$CHROME" \
    --no-sandbox --disable-gpu --password-store=basic \
    --remote-debugging-port=9222 --remote-allow-origins='*' \
    --user-data-dir=/profile --window-position=0,0 --window-size=1440,900 \
    --lang=pt-BR --accept-lang=pt-BR,pt,en \
    --no-first-run --no-default-browser-check --disable-features=Translate \
    about:blank &
  CHROME_PID=$!
}

# Supervisor: Xvfb e navegador são filhos deste subshell (o wait funciona); se um cair, sobe de novo
# (o MCP reconecta no próximo uso).
( start_xvfb
  start_chrome
  while true; do
    wait "$CHROME_PID" 2>/dev/null || true
    sleep 1
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then echo "Xvfb reiniciando"; start_xvfb; fi
    echo "navegador reiniciando"; start_chrome
  done ) &

for _ in $(seq 1 60); do
  node -e "fetch('http://127.0.0.1:9222/json/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 0.5
done

node /browser/cdp-proxy.mjs &

exec node /app/cli.js \
  --cdp-endpoint http://127.0.0.1:9222 \
  --host 0.0.0.0 --port 8931 \
  --allowed-hosts 'atria-browser,atria-browser:8931,localhost,127.0.0.1' \
  --output-dir /workspace/.atria/browser \
  --viewport-size 1440x900
