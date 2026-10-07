# Instalação do Atria OS — referência

Resumo e passo a passo rápido no [README](../README.md). Aqui ficam os detalhes.

## O que sobe

| Serviço | Para quê | Memória (limite) |
|---|---|---|
| `atria` | painel, API, Yui (cérebro + voz), fila de agentes Claude Code, terminal | 2 GB |
| `atria-browser` | Chromium dos agentes (Playwright MCP) + transmissão ao vivo para o painel | 1 GB |
| `atria-code` | VS Code open source (Vault e projetos), só pelo `/code` do painel logado | 1,5 GB |
| `atria-postgres` | base da Empresa: documentos, páginas, trechos, campos extraídos | 512 MB |
| `atria-qdrant` | vetores da busca semântica da Empresa (com API key) | 768 MB |
| `atria-docling` | leitura e OCR de arquivos (PDF, imagem, Office) | 3 GB |
| `atria-dockerproxy` | leitura de containers e logs (somente leitura, sem POST) | 64 MB |
| `atria-caddy` | HTTPS automático — só no modo `caddy` (profile `edge`) | 128 MB |

Os limites são tetos; em repouso o conjunto usa ~3 GB. Picos acontecem ao processar documentos (docling)
e com vários agentes rodando.

Volumes (prefixo = nome do projeto, padrão `atria-os_`):

| Volume | Conteúdo |
|---|---|
| `data` | `atria.db` (SQLite: conversas, execuções, configurações, lembretes), `home/` (logins Claude e GitHub), chaves VAPID |
| `workspace` | projetos clonados, `.atria/vault` (memória Obsidian), `.atria/workflows`, agentes |
| `pg`, `qdrant` | base da Empresa |
| `browser-profile` | perfil do navegador dos agentes (logins feitos por eles) |
| `caddy-data`, `caddy-config` | certificados (modo caddy) |

Arquivos do repositório usados em tempo de execução: `.env`, `Caddyfile`, `browser/` (montado no navegador),
`docker-compose.yml` e `docker-compose.port.yml` (modo `none`).

## Passo a passo

1. **DNS**: registro A do domínio do painel para o IP da VPS.
2. **Docker**: `curl -fsSL https://get.docker.com | sudo sh` (inclui o plugin compose).
3. **Código**: `gh repo clone eliveutonsouza/atria-os /opt/atria-os` (repositório privado — `gh auth login`
   antes, ou `git clone https://<TOKEN>@github.com/eliveutonsouza/atria-os.git`).
4. **Instalar**: `sudo ./install.sh` na pasta do projeto.
   - `--env-only` só gera o `.env` para revisar antes de subir.
   - `--yes` usa variáveis de ambiente em vez de perguntas:
     `ATRIA_DOMAIN`, `ACME_EMAIL`, `OPENAI_API_KEY`, `ATRIA_USER_NAME`, `TZ`, `ATRIA_PROXY`, `ATRIA_HTTP_PORT`, `ATRIA_PROJECT`.
   - Rodar de novo é seguro: valores existentes no `.env` são mantidos.
5. **Primeiro acesso**: abra o domínio, crie a senha e siga **Configurações › Primeiros passos**.

Arquitetura: x86_64 e ARM64. O Dockerfile liga o binário `claude` do pacote da arquitetura certa e todas
as imagens de terceiros têm as duas variantes.

## Proxy HTTPS

### Caddy (`ATRIA_PROXY=caddy`)
VPS sem nada em 80/443. O Caddy emite o certificado sozinho (`ACME_EMAIL` obrigatório). Config em `Caddyfile`.

### Traefik existente (`ATRIA_PROXY=traefik`)
O serviço `atria` publica labels (`traefik.http.routers.<projeto>…`). Se o seu Traefik usa outros nomes, defina no `.env`:
`ATRIA_TRAEFIK_ENTRYPOINT=<entrypoint https>` e `ATRIA_TRAEFIK_CERTRESOLVER=<resolver acme>`.
O Traefik precisa enxergar os containers pelo provider Docker (mesma rede ou `network_mode: host`).

Trocou de domínio? Com `ATRIA_OLD_DOMAIN=<domínio antigo>` no `.env` e
`COMPOSE_FILE=docker-compose.yml:docker-compose.redirect.yml` (o `install.sh` grava os dois quando você passa
`ATRIA_OLD_DOMAIN`), o domínio antigo ganha certificado e redireciona de forma permanente para o novo, mantendo o caminho.

### Outro proxy (nginx)
`ATRIA_PROXY=none` publica `127.0.0.1:${ATRIA_HTTP_PORT:-8080}` (via `docker-compose.port.yml`, ativado pelo
`COMPOSE_FILE` no `.env`). O painel usa SSE e WebSocket: sem buffer e com upgrade.

```nginx
server {
  listen 443 ssl http2;
  server_name atria.seudominio.com;
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
`ATRIA_SECURE_COOKIES=0` no `.env` e o navegador não libera o microfone.

## Conectar contas (pelo painel)

- **Claude**: Configurações › Conexões › *Conectar conta Claude* abre um terminal no próprio painel.
  Digite `/login`, escolha a conta claude.ai, abra o link, autorize e cole o código; `/exit` no fim.
  O login fica no volume `data` e traz os conectores MCP, skills e plugins da sua conta.
- **GitHub**: *Conectar GitHub* roda `gh auth login` — abra o link, digite o código de 8 letras.
- **OpenAI**: cole a chave de API; o painel testa antes de salvar.
- Conectores que pedem autorização (Facebook, Stripe, n8n…) são autorizados em
  <https://claude.ai/settings/connectors>.

## Configurações

Tudo que está em **Configurações** (nome, e-mail, cidade, voz, modelos, concorrência de agentes, aprovações)
fica salvo no banco e tem prioridade sobre o `.env`. O `.env` é só o ponto de partida da instalação.
Variáveis comentadas no [`.env.example`](../.env.example).

## Monitoramento remoto (opcional)

Para quem administra várias instalações do Atria OS: cada instância manda um pulso a cada 30 s para o **Atria Central**
do administrador e expõe uma URL de saúde. Só vão métricas (CPU, RAM, disco, containers, contagem de
execuções, limites e custo de IA, erros técnicos); conversas, tarefas, resultados e documentos nunca saem da VPS.

1. No Atria Central, cadastre a instância e copie o endereço do monitor e a chave `atk_…` (chaves `ymk_…` antigas continuam valendo).
2. Na instalação, informe os dois quando o `install.sh` perguntar, ou passe por variável:

   ```bash
   sudo ATRIA_MONITOR_URL=https://central.seudominio.com ATRIA_MONITOR_KEY=atk_... ./install.sh --yes
   ```

   Com endereço e chave no `.env`, o pulso liga sozinho.
3. Ou depois, pelo painel: **Configurações › Sistema › Monitoramento remoto** (liga/desliga, endereço,
   chave, **Testar conexão**, status do último envio e a prévia "O que é enviado").

| Caminho | O que faz |
|---|---|
| `POST <monitor>/api/ingest` | pulso a cada 30 s (timeout 10 s; em falha espera 30 s, 60 s, 120 s… até 5 min) |
| `GET https://<domínio>/api/telemetry` | URL de saúde: o mesmo JSON, com os últimos 50 eventos |

As duas usam `Authorization: Bearer <chave>`. Sem a chave certa a URL de saúde responde 401; com o
monitoramento desligado, 503. A versão mostrada no monitor é o commit do build (`install.sh` e `--update`
passam `ATRIA_VERSION` sozinhos).

## Atualizar

```bash
sudo ./install.sh --update
```

`git pull --ff-only`, espera execuções em andamento terminarem (até 20 min) e reconstrói.
Migrações de banco rodam sozinhas no boot.

**Instalação de antes do nome Atria OS (Yui Console).** Rode `sudo ./install.sh --update` duas vezes se a
primeira parar pedindo `ATRIA_PG_PASSWORD` (o script antigo ainda estava em memória). A versão nova:
- copia cada `YUI_X=…` do `.env` para `ATRIA_X=…` (as linhas antigas ficam; o código aceita as duas);
- para os containers antigos e copia os volumes `<projeto>_yui-data`, `_yui-workspace`, `_yui-pg`, `_yui-qdrant`,
  `_yui-browser-profile`, `_yui-caddy-*` para `atria-os_data`, `_workspace`, `_pg`, `_qdrant`, `_browser-profile`,
  `_caddy-*` (os antigos ficam intactos para rollback — apague depois de conferir);
- no boot, renomeia `/data/yui.db` → `atria.db` e `/workspace/.yui` → `/workspace/.atria`, e troca o nome do
  produto nos agentes e notas semeados (cópia em `/workspace/.atria/backup/rename_atria_v1`).
Depois disso é preciso entrar de novo no painel (o cookie de sessão mudou de nome).

## Backup

```bash
sudo ./install.sh --backup
```

Gera em `./backups/`:

- `atria-AAAAMMDD-HHMM.tgz` — `data` (com cópia consistente do SQLite em `atria-backup.db`), `workspace`
  (sem `node_modules`) e `qdrant`;
- `atria-AAAAMMDD-HHMM-empresa.pgdump` — dump do Postgres da Empresa;
- `env-AAAAMMDD-HHMM` — cópia do `.env` (permissão 600).

Contém logins e segredos: **guarde fora da VPS** e protegido. A pasta `backups/` está no `.gitignore`.
Agende com cron do host, ex.: `0 3 * * * cd /opt/atria-os && ./install.sh --backup >/dev/null`.

## Restaurar um backup

Numa VPS nova (ou na mesma), com o mesmo nome de projeto (`atria-os` por padrão):

```bash
# 1. instale normalmente e pare os serviços com dados
sudo ./install.sh
docker compose stop atria atria-qdrant

# 2. copie os arquivos do backup para ./backups/ e extraia nos volumes
B=atria-AAAAMMDD-HHMM
docker run --rm -v atria-os_data:/data -v atria-os_workspace:/workspace \
  -v atria-os_qdrant:/qdrant -v "$PWD/backups:/in:ro" alpine sh -c "
    tar xzf /in/$B.tgz -C / &&
    mv /data/atria-backup.db /data/atria.db && rm -f /data/atria.db-wal /data/atria.db-shm &&
    chown -R 1000:1000 /data /workspace"

# 3. base da Empresa (Postgres)
docker exec -i atria-os-atria-postgres-1 pg_restore -U yui -d yui --clean --if-exists < "backups/$B-empresa.pgdump"

# 4. sobe de novo
docker compose up -d
```

A senha do painel, os logins Claude/GitHub e as configurações voltam com o banco. Se o domínio mudou,
reinstale o app (PWA) e reative as notificações nos aparelhos. Backups antigos sem a pasta `qdrant/` também
funcionam (os vetores são recriados ao reprocessar documentos).

## Segunda instalação na mesma VPS

Útil para testar uma versão nova sem tocar na produção:

```bash
git clone … /opt/atria-teste && cd /opt/atria-teste
ATRIA_PROJECT=atria-teste ATRIA_PROXY=none ATRIA_HTTP_PORT=18080 ATRIA_DOMAIN=teste.local sudo -E ./install.sh --yes
# remover depois:
docker compose down -v --rmi local
```

`ATRIA_PROJECT` muda o prefixo de containers, volumes, imagens e do router do Traefik. Não troque numa
instalação existente: o Docker criaria volumes novos (vazios).

## Problemas comuns

- **Certificado não sai**: confira o DNS (`getent hosts <domínio>`) e se as portas 80/443 estão livres
  (`ss -ltn`). Logs: `docker compose logs atria-caddy`.
- **Agentes não rodam**: Configurações › Sistema mostra o estado do Claude; reconecte a conta.
- **Sem voz**: precisa da chave OpenAI com acesso ao modelo de voz (Configurações › Conexões › Testar chave).
- **Empresa não processa documentos**: `docker compose logs atria-docling` — ele leva ~40 s para subir e
  precisa de até 3 GB; a primeira tentativa de um job pode falhar e é refeita sozinha.
- **Logs gerais**: `docker compose logs -f atria`.
