# Atria OS

O sistema operacional da sua empresa com IA, rodando na sua VPS. Você conversa com a **Yui** (voz ou texto) e ela organiza o
trabalho de uma equipe de agentes **Claude Code**: abre telas, cria planos, delega tarefas, roda workflows
agendados, lembra seus compromissos e mostra os resultados. Quando preferir, use o **dashboard** completo
(sidebar na borda esquerda) — a Yui fica minimizada no canto, esperando você.

- **Conversa** — voz full-duplex (OpenAI GPT-Live) e texto. A Yui sabe a data, a hora, o clima e os feriados,
  cria lembretes e timers, abre telas e delega trabalho aos agentes.
- **Agentes** — Claude Code com a sua conta (conectores MCP, skills e plugins dela), navegador próprio para
  testar sites, terminal interativo e bloqueio automático do que é catastrófico.
- **Dashboard** — visão geral, operações ao vivo, agentes, execuções, missões, workflows (Mermaid), agendamentos,
  projetos do GitHub, navegador ao vivo, terminal, VS Code, Vault/Cérebro (memória em Obsidian), base de
  conhecimento da **Empresa** (OCR + busca), ajuda e configurações.
- **App** — instalável no celular e no desktop (PWA), com notificações de aprovações, entregas e lembretes.

---

## Sumário

1. [Requisitos](#requisitos)
2. [Instalar numa VPS nova](#instalar-numa-vps-nova)
3. [Primeiro acesso](#primeiro-acesso)
4. [Modos de proxy HTTPS](#modos-de-proxy-https)
5. [O que sobe (serviços e volumes)](#o-que-sobe)
6. [Configuração (.env)](#configuração-env)
7. [Atualizar, backup e desinstalar](#atualizar-backup-e-desinstalar)
8. [Desenvolvimento](#desenvolvimento)
9. [Problemas comuns](#problemas-comuns)

Como funciona por dentro: [docs/arquitetura.md](docs/arquitetura.md).

---

## Requisitos

| Item | Mínimo | Recomendado |
|---|---|---|
| Sistema | Linux x86_64 ou ARM64 (Ubuntu 22.04+/Debian 12+) | Ubuntu 24.04 |
| Docker | Engine 24+ com plugin **compose v2** | última estável |
| RAM | 4 GB (base Empresa lenta/instável) | **8 GB** |
| Disco livre | 20 GB | 40 GB |
| Domínio | um (sub)domínio com registro **A** para o IP da VPS | — |
| Contas | **Claude** Pro/Max (agentes) e chave de API da **OpenAI** (voz e cérebro) | GitHub (projetos) |

Portas: com o Caddy (padrão em VPS limpa) o painel usa **80** e **443**. Nada mais fica exposto — banco,
vetores, navegador e VS Code só são alcançados pela rede interna do Docker.

## Instalar numa VPS nova

```bash
# 1. DNS: crie um registro A  atria.seudominio.com → IP da VPS  (espere propagar)

# 2. Docker + compose (pule se já tiver)
curl -fsSL https://get.docker.com | sudo sh

# 3. Código (repositório privado: precisa de acesso à conta do GitHub)
sudo apt-get install -y gh git        # ou: https://cli.github.com
gh auth login                          # GitHub.com → HTTPS → login pelo navegador
gh repo clone eliveutonsouza/atria-os /opt/atria-os
cd /opt/atria-os
#   sem gh: crie um token em github.com/settings/tokens (escopo "repo") e use
#   git clone https://<TOKEN>@github.com/eliveutonsouza/atria-os.git /opt/atria-os

# 4. Instalar
sudo ./install.sh
```

O instalador:

1. confere Docker, compose, RAM, disco e arquitetura;
2. pergunta **domínio**, **e-mail** (certificado HTTPS), **chave OpenAI** (pode deixar para o painel) e **fuso horário**;
3. gera o `.env` com segredos aleatórios (`SESSION_SECRET`, senhas do Postgres e do Qdrant) — permissão 600;
4. escolhe o proxy: usa um **Traefik** que já esteja rodando, senão sobe o **Caddy** com HTTPS automático;
5. builda as imagens e sobe tudo (a primeira vez leva 5–10 min), esperando o painel ficar saudável.

Rodar de novo é seguro: valores existentes no `.env` são mantidos.

**Sem perguntas** (automação):

```bash
ATRIA_DOMAIN=atria.seudominio.com ACME_EMAIL=voce@seudominio.com OPENAI_API_KEY=sk-... \
TZ=America/Sao_Paulo ATRIA_USER_NAME="Seu Nome" sudo -E ./install.sh --yes
```

`./install.sh --env-only` só gera o `.env` para você revisar antes de subir.

## Primeiro acesso

1. Abra `https://<seu domínio>` — a primeira tela pede para **criar a sua senha**.
2. **Configurações › Conexões**:
   - **Conectar conta Claude** — abre um terminal no próprio painel: digite `/login`, abra o link, autorize e
     cole o código. Agentes passam a usar seus conectores (Gmail, Calendar, Drive, Linear…), skills e plugins.
   - **OpenAI** — cole a chave de API (platform.openai.com; o plano ChatGPT não serve). O painel testa antes de salvar.
   - **GitHub** (opcional) — mesmo esquema pelo terminal (`gh auth login`); seus repositórios aparecem em Projetos.
3. **Configurações › Conta** — nome, e-mail e **cidade** (clima e feriados da Yui).
4. Instale como app (⌘K › Instalar app) e ative as notificações neste dispositivo.

A aba **Primeiros passos** das Configurações mostra o que falta. Uso diário: segure **Espaço** para falar
(3 toques = conversa contínua) ou digite; `Ctrl/⌘ K` abre os comandos; ``Ctrl/⌘ ` `` abre o terminal.

## Modos de proxy HTTPS

Definido por `ATRIA_PROXY` (o instalador detecta sozinho com `auto`):

| Modo | Quando usar | O que acontece |
|---|---|---|
| `caddy` | VPS sem nada nas portas 80/443 | sobe o `atria-caddy` com certificado Let's Encrypt automático (`ACME_EMAIL` obrigatório) |
| `traefik` | já existe um Traefik com provider Docker | o serviço `atria` publica labels; ajuste `ATRIA_TRAEFIK_ENTRYPOINT` / `ATRIA_TRAEFIK_CERTRESOLVER` se os nomes forem outros |
| `none` | você já tem nginx, Apache, Cloudflare Tunnel… | publica `127.0.0.1:${ATRIA_HTTP_PORT:-8080}`; aponte seu proxy para lá |

No modo `none`, o proxy precisa passar **SSE** (eventos ao vivo) e **WebSocket** (terminal, navegador, VS Code)
sem buffer. Exemplo nginx em [docs/instalacao.md](docs/instalacao.md#outro-proxy-nginx).

```bash
ATRIA_PROXY=none ATRIA_HTTP_PORT=8080 sudo -E ./install.sh
```

## O que sobe

| Serviço | Função | Memória (limite) | Volume |
|---|---|---|---|
| `atria` | painel, API, Yui (cérebro + voz), fila de agentes Claude Code, terminal | 2 GB | `data`, `workspace` |
| `atria-browser` | Chromium dos agentes (Playwright MCP) + transmissão ao vivo | 1 GB | `browser-profile` |
| `atria-code` | VS Code (openvscode-server) para Vault e projetos, atrás do login do painel | 1,5 GB | `workspace` |
| `atria-postgres` | base da Empresa (documentos, trechos, campos) | 512 MB | `pg` |
| `atria-qdrant` | vetores da busca semântica da Empresa | 768 MB | `qdrant` |
| `atria-docling` | leitura/OCR de PDFs e imagens | 3 GB | — |
| `atria-dockerproxy` | leitura de containers e logs (sem escrita) para a tela Infra | 64 MB | socket do Docker (ro) |
| `atria-caddy` | HTTPS automático (só no modo `caddy`) | 128 MB | `caddy-data`, `caddy-config` |

Os volumes guardam tudo que é seu: `data` (banco SQLite, logins Claude/GitHub, configurações, chaves
de push), `workspace` (projetos clonados, Vault, workflows, agentes). As imagens são construídas na
própria VPS a partir deste repositório; as imagens de terceiros são multi-arquitetura e fixadas por digest.

## Configuração (.env)

O `install.sh` cria o `.env` a partir do [`.env.example`](.env.example) (comentado). Quase tudo também é
editável em **Configurações** no painel, que tem prioridade sobre o `.env`.

| Variável | Para quê |
|---|---|
| `ATRIA_DOMAIN` | domínio do painel |
| `ACME_EMAIL` | e-mail do certificado HTTPS (modo caddy) |
| `SESSION_SECRET`, `ATRIA_PG_PASSWORD`, `ATRIA_QDRANT_KEY` | segredos gerados pelo instalador — não troque depois de instalado |
| `TZ` | fuso horário (hora da Yui, cron, lembretes) |
| `ATRIA_PROXY`, `ATRIA_HTTP_PORT`, `ATRIA_BIND` | modo de proxy e porta do modo `none` |
| `OPENAI_API_KEY`, `ATRIA_LIVE_MODEL`, `ATRIA_BRAIN_MODEL`, `ATRIA_PLANNER_MODEL`, `ATRIA_VOICE` | voz e cérebro |
| `CLAUDE_CODE_OAUTH_TOKEN`, `ATRIA_CLAUDE_MODEL`, `ATRIA_MAX_CONCURRENT_RUNS` | alternativa ao login pelo painel; modelo e paralelismo dos agentes |
| `ATRIA_USER_NAME`, `ATRIA_USER_EMAIL`, `ATRIA_USER_CITY` | dados do dono (também no painel) |
| `ATRIA_PROJECT` | nome do projeto Docker; mude só para uma segunda instalação isolada na mesma VPS |

## Atualizar, backup e desinstalar

```bash
sudo ./install.sh --update   # git pull + rebuild, esperando execuções em andamento terminarem
sudo ./install.sh --backup   # ./backups/atria-AAAAMMDD-HHMM.tgz (+ -empresa.pgdump e cópia do .env)
```

O backup leva banco, logins, configurações, projetos, Vault e vetores da Empresa; o Postgres vai num
dump separado. **Guarde fora da VPS** (contém segredos). Restauração passo a passo:
[docs/instalacao.md](docs/instalacao.md#restaurar-um-backup).

Desinstalar:

```bash
docker compose down          # para tudo, mantém os dados
docker compose down -v       # ⚠ apaga TODOS os volumes (dados, logins, projetos) — irreversível
```

## Desenvolvimento

```
server/          API Fastify + Yui (TypeScript rodando direto no Node 24)
  src/           brain.ts (cérebro, Responses API) · live.ts (voz GPT-Live) · runs.ts (agentes, Claude Agent SDK)
                 ambiente.ts (data/hora/clima/feriados) · lembretes.ts · workflows.ts · missions.ts · vault.ts · company/
  test/          testes node:test
  scripts/       eval-brain.ts (bateria de pedidos reais → tools esperadas)
web/             painel React + Vite (PWA)
shared/          tipos e protocolo comuns
browser/         entrypoint do Chromium + proxy CDP
code/            imagem do VS Code com a extensão atria-bridge
workspace-seed/  Vault, workflows e ferramentas iniciais copiados no primeiro boot
docs/            instalação, auditorias e guias da Ajuda (docs/ajuda, servidos no painel)
e2e/             testes Playwright (desktop e 6 aparelhos móveis)
```

```bash
cd server && npm ci && npm run typecheck && node --test test/*.test.ts
cd web && npm ci && npm run lint && npm run build
# cérebro (gasta tokens OpenAI; as ferramentas não executam):
cd server && ATRIA_DATA_DIR=$(mktemp -d) ATRIA_WORKSPACE_DIR=$(mktemp -d) OPENAI_API_KEY=sk-... npx tsx scripts/eval-brain.ts [filtro]
```

Deploy na VPS de produção: `./scripts-deploy.sh` (espera execuções terminarem, rebuild, sobe e roda o e2e —
precisa de `ATRIA_E2E_PASSWORD`; `--no-e2e` pula). O **CI** (GitHub Actions) roda em todo push: gitleaks,
tipos e testes do servidor, lint e build do painel, `docker compose config` nos três modos e build das duas imagens.

Mapa dos módulos, fluxo de um pedido e onde ficam os dados: [docs/arquitetura.md](docs/arquitetura.md).

Ao mudar uma tela, atualize o guia correspondente em `docs/ajuda/guias/`.

## Problemas comuns

- **Certificado não sai** — confira o DNS (`getent hosts <domínio>`) e as portas 80/443 livres (`ss -ltn`).
  Logs: `docker compose logs atria-caddy`.
- **"algo já usa a porta 443"** — já existe um proxy na VPS: use `ATRIA_PROXY=traefik` (se for Traefik) ou `ATRIA_PROXY=none`.
- **Painel não fica saudável** — `docker compose logs -f atria`.
- **Agentes não rodam** — Configurações › Sistema mostra o estado do Claude; reconecte a conta.
- **Sem voz** — a chave OpenAI precisa de acesso ao modelo de voz (Configurações › Conexões › Testar chave).
- **Yui sem clima** — preencha a cidade em Configurações › Conta.
- **Documentos da Empresa demoram** — o `atria-docling` leva ~40 s para subir e usa até 3 GB; com pouca RAM, ele é o primeiro a sofrer.

Referência completa: [docs/instalacao.md](docs/instalacao.md).
