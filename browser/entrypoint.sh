#!/bin/sh
# Sidecar do navegador dos agentes: um Chromium headless com CDP (9222 local; exposto em 9223 pelo
# cdp-proxy.mjs, assistível ao vivo pelo console) + Playwright MCP (porta 8931) conectado a ESSE Chromium via --cdp-endpoint.
# Assim o que os agentes fazem pelo MCP aparece no screencast da página Navegador.
set -eu
CHROME=$(ls -d /ms-playwright/chromium-*/chrome-linux64/chrome | head -1)
mkdir -p /profile /workspace/.yui/browser 2>/dev/null || true
# Este sidecar roda como root; o console roda como node (uid 1000) e precisa escrever em /workspace/.yui.
# Em volume novo o mkdir acima criaria tudo como root e o console morreria com EACCES no seed.
chown 1000:1000 /workspace /workspace/.yui /workspace/.yui/browser 2>/dev/null || true
rm -f /profile/SingletonLock /profile/SingletonSocket /profile/SingletonCookie

start_chrome() {
  "$CHROME" \
    --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --remote-debugging-port=9222 --remote-allow-origins='*' \
    --user-data-dir=/profile --window-size=1440,900 --lang=pt-BR \
    --no-first-run --no-default-browser-check --disable-features=Translate \
    about:blank &
  CHROME_PID=$!
}

start_chrome
for i in $(seq 1 60); do
  node -e "fetch('http://127.0.0.1:9222/json/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 0.5
done

node /browser/cdp-proxy.mjs &

# Chromium caiu → reinicia (o MCP reconecta no próximo uso).
( while true; do
    wait "$CHROME_PID" 2>/dev/null || true
    sleep 1
    if ! kill -0 "$CHROME_PID" 2>/dev/null; then echo "chromium reiniciando"; start_chrome; fi
    sleep 2
  done ) &

exec node /app/cli.js \
  --cdp-endpoint http://127.0.0.1:9222 \
  --host 0.0.0.0 --port 8931 \
  --allowed-hosts 'yui-browser,yui-browser:8931,localhost,127.0.0.1' \
  --output-dir /workspace/.yui/browser \
  --viewport-size 1440x900
