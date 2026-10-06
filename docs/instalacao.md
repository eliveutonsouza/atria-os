# Instalação do Yui Console — referência

Resumo e passo a passo rápido no [README](../README.md). Aqui ficam os detalhes.

## O que sobe

| Serviço | Para quê | Memória (limite) |
|---|---|---|
| `yui-console` | painel, API, Yui (cérebro + voz), fila de agentes Claude Code, terminal | 2 GB |
| `yui-browser` | Chromium dos agentes (Playwright MCP) + transmissão ao vivo para o painel | 1 GB |
| `yui-code` | VS Code open source (Vault e projetos), só pelo `/code` do painel logado | 1,5 GB |
| `yui-postgres` | base da Empresa: documentos, páginas, trechos, campos extraídos | 512 MB |
| `yui-qdrant` | vetores da busca semântica da Empresa (com API key) | 768 MB |
| `yui-docling` | leitura e OCR de arquivos (PDF, imagem, Office) | 3 GB |
| `yui-dockerproxy` | leitura de containers e logs (somente leitura, sem POST) | 64 MB |
| `yui-caddy` | HTTPS automático — só no modo `caddy` (profile `edge`) | 128 MB |

Os limites são tetos; em repouso o conjunto usa ~3 GB. Picos acontecem ao processar documentos (docling)
e com vários agentes rodando.

Volumes (prefixo = nome do projeto, padrão `yui-console_`):

| Volume | Conteúdo |
|---|---|
| `yui-data` | `yui.db` (SQLite: conversas, execuções, configurações, lembretes), `home/` (logins Claude e GitHub), chaves VAPID |
| `yui-workspace` | projetos clonados, `.yui/vault` (memória Obsidian), `.yui/workflows`, agentes |
| `yui-pg`, `yui-qdrant` | base da Empresa |
| `yui-browser-profile` | perfil do navegador dos agentes (logins feitos por eles) |
| `yui-caddy-data`, `yui-caddy-config` | certificados (modo caddy) |

Arquivos do repositório usados em tempo de execução: `.env`, `Caddyfile`, `browser/` (montado no navegador),
`docker-compose.yml` e `docker-compose.port.yml` (modo `none`).

## Passo a passo

1. **DNS**: registro A do domínio do painel para o IP da VPS.
2. **Docker**: `curl -fsSL https://get.docker.com | sudo sh` (inclui o plugin compose).
3. **Código**: `gh repo clone eliveutonsouza/yui-console /opt/yui-console` (repositório privado — `gh auth login`
   antes, ou `git clone https://<TOKEN>@github.com/eliveutonsouza/yui-console.git`).
4. **Instalar**: `sudo ./install.sh` na pasta do projeto.
   - `--env-only` só gera o `.env` para revisar antes de subir.
   - `--yes` usa variáveis de ambiente em vez de perguntas:
     `YUI_DOMAIN`, `ACME_EMAIL`, `OPENAI_API_KEY`, `YUI_USER_NAME`, `TZ`, `YUI_PROXY`, `YUI_HTTP_PORT`, `YUI_PROJECT`.
   - Rodar de novo é seguro: valores existentes no `.env` são mantidos.
5. **Primeiro acesso**: abra o domínio, crie a senha e siga **Configurações › Primeiros passos**.

Arquitetura: x86_64 e ARM64. O Dockerfile liga o binário `claude` do pacote da arquitetura certa e todas
as imagens de terceiros têm as duas variantes.

## Proxy HTTPS

### Caddy (`YUI_PROXY=caddy`)
VPS sem nada em 80/443. O Caddy emite o certificado sozinho (`ACME_EMAIL` obrigatório). Config em `Caddyfile`.

### Traefik existente (`YUI_PROXY=traefik`)
O `yui-console` publica labels (`traefik.http.routers.<projeto>…`). Se o seu Traefik usa outros nomes, defina no `.env`:
`YUI_TRAEFIK_ENTRYPOINT=<entrypoint https>` e `YUI_TRAEFIK_CERTRESOLVER=<resolver acme>`.
O Traefik precisa enxergar os containers pelo provider Docker (mesma rede ou `network_mode: host`).

### Outro proxy (nginx)
`YUI_PROXY=none` publica `127.0.0.1:${YUI_HTTP_PORT:-8080}` (via `docker-compose.port.yml`, ativado pelo
`COMPOSE_FILE` no `.env`). O painel usa SSE e WebSocket: sem buffer e com upgrade.

```nginx
server {
  listen 443 ssl http2;
  server_name yui.seudominio.com;
  # ssl_certificate … (certbot, Cloudflare etc.)
  client_max_body_size 100m;           # upload de documentos da Empresa

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;               # SSE
    proxy_read_timeout 1h;
  }
}
```

Cloudflare Tunnel: aponte o hostname para `http://127.0.0.1:8080`.
O painel exige HTTPS (cookies seguros, microfone, PWA); acesso só por HTTP em rede local precisa de
`YUI_SECURE_COOKIES=0` no `.env` e o navegador não libera o microfone.

## Conectar contas (pelo painel)

- **Claude**: Configurações › Conexões › *Conectar conta Claude* abre um terminal no próprio painel.
  Digite `/login`, escolha a conta claude.ai, abra o link, autorize e cole o código; `/exit` no fim.
  O login fica no volume `yui-data` e traz os conectores MCP, skills e plugins da sua conta.
- **GitHub**: *Conectar GitHub* roda `gh auth login` — abra o link, digite o código de 8 letras.
- **OpenAI**: cole a chave de API; o painel testa antes de salvar.
- Conectores que pedem autorização (Facebook, Stripe, n8n…) são autorizados em
  <https://claude.ai/settings/connectors>.

## Configurações

Tudo que está em **Configurações** (nome, e-mail, cidade, voz, modelos, concorrência de agentes, aprovações)
fica salvo no banco e tem prioridade sobre o `.env`. O `.env` é só o ponto de partida da instalação.
Variáveis comentadas no [`.env.example`](../.env.example).

## Atualizar

```bash
sudo ./install.sh --update
```

`git pull --ff-only`, espera execuções em andamento terminarem (até 20 min) e reconstrói.
Migrações de banco rodam sozinhas no boot.

## Backup

```bash
sudo ./install.sh --backup
```

Gera em `./backups/`:

- `yui-AAAAMMDD-HHMM.tgz` — `yui-data` (com cópia consistente do SQLite em `yui-backup.db`), `yui-workspace`
  (sem `node_modules`) e `yui-qdrant`;
- `yui-AAAAMMDD-HHMM-empresa.pgdump` — dump do Postgres da Empresa;
- `env-AAAAMMDD-HHMM` — cópia do `.env` (permissão 600).

Contém logins e segredos: **guarde fora da VPS** e protegido. A pasta `backups/` está no `.gitignore`.
Agende com cron do host, ex.: `0 3 * * * cd /opt/yui-console && ./install.sh --backup >/dev/null`.

## Restaurar um backup

Numa VPS nova (ou na mesma), com o mesmo nome de projeto (`yui-console` por padrão):

```bash
# 1. instale normalmente e pare os serviços com dados
sudo ./install.sh
docker compose stop yui-console yui-qdrant

# 2. copie os arquivos do backup para ./backups/ e extraia nos volumes
B=yui-AAAAMMDD-HHMM
docker run --rm -v yui-console_yui-data:/data -v yui-console_yui-workspace:/workspace \
  -v yui-console_yui-qdrant:/qdrant -v "$PWD/backups:/in:ro" alpine sh -c "
    tar xzf /in/$B.tgz -C / &&
    mv /data/yui-backup.db /data/yui.db && rm -f /data/yui.db-wal /data/yui.db-shm &&
    chown -R 1000:1000 /data /workspace"

# 3. base da Empresa (Postgres)
docker exec -i yui-console-yui-postgres-1 pg_restore -U yui -d yui --clean --if-exists < "backups/$B-empresa.pgdump"

# 4. sobe de novo
docker compose up -d
```

A senha do painel, os logins Claude/GitHub e as configurações voltam com o banco. Se o domínio mudou,
reinstale o app (PWA) e reative as notificações nos aparelhos. Backups antigos sem a pasta `qdrant/` também
funcionam (os vetores são recriados ao reprocessar documentos).

## Segunda instalação na mesma VPS

Útil para testar uma versão nova sem tocar na produção:

```bash
git clone … /opt/yui-teste && cd /opt/yui-teste
YUI_PROJECT=yui-teste YUI_PROXY=none YUI_HTTP_PORT=18080 YUI_DOMAIN=teste.local sudo -E ./install.sh --yes
# remover depois:
docker compose down -v --rmi local
```

`YUI_PROJECT` muda o prefixo de containers, volumes, imagens e do router do Traefik. Não troque numa
instalação existente: o Docker criaria volumes novos (vazios).

## Problemas comuns

- **Certificado não sai**: confira o DNS (`getent hosts <domínio>`) e se as portas 80/443 estão livres
  (`ss -ltn`). Logs: `docker compose logs yui-caddy`.
- **Agentes não rodam**: Configurações › Sistema mostra o estado do Claude; reconecte a conta.
- **Sem voz**: precisa da chave OpenAI com acesso ao modelo de voz (Configurações › Conexões › Testar chave).
- **Empresa não processa documentos**: `docker compose logs yui-docling` — ele leva ~40 s para subir e
  precisa de até 3 GB; a primeira tentativa de um job pode falhar e é refeita sozinha.
- **Logs gerais**: `docker compose logs -f yui-console`.
