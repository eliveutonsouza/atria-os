# Navegador dos agentes: Playwright MCP (mesma versão pinada de antes) + navegador COM tela virtual (Xvfb),
# em vez de headless. amd64 usa o Google Chrome estável (repositório oficial do Google); arm64 usa o
# Chromium que já vem na imagem, porque o Google não publica Chrome para Linux arm64.
# Sem nenhuma alteração de User-Agent ou de impressão digital: é o navegador normal rodando numa tela virtual.
FROM mcr.microsoft.com/playwright/mcp@sha256:77dccc5ce9e94cb8ae7ebea87ddbb6cd54b05760c4d63c54e16accf2726b8734
# v0.0.82

ARG TARGETARCH
# Roda como root: o volume do perfil nasce root e o navegador já usa --no-sandbox num container isolado.
USER root
ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Sao_Paulo LANG=pt_BR.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl xvfb xauth tzdata locales \
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-liberation \
 && sed -i 's/^# *\(pt_BR.UTF-8\)/\1/; s/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen && locale-gen \
 && if [ "$TARGETARCH" = "amd64" ]; then \
      install -d -m 0755 /etc/apt/keyrings \
      && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub -o /etc/apt/keyrings/google-chrome.asc \
      && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.asc] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
      && apt-get update \
      && apt-get install -y --no-install-recommends google-chrome-stable \
      && google-chrome-stable --version; \
    fi \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh cdp-proxy.mjs /browser/
RUN chmod 0755 /browser/entrypoint.sh

EXPOSE 8931 9223
ENTRYPOINT ["/bin/sh", "/browser/entrypoint.sh"]
