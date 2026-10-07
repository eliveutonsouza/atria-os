# Instalação do Atria OS

## O que sobe

| Serviço | Para quê | Memória |
|---|---|---|
| `atria` | painel, API, Yui, fila de agentes Claude Code, terminal | até 2 GB |
| `atria-browser` | Chromium dos agentes (Playwright) + transmissão ao vivo para o painel | até 1 GB |
| `atria-dockerproxy` | leitura de containers e logs (somente leitura, sem POST) | 64 MB |
| `atria-caddy` | HTTPS automático — só quando não há Traefik na VPS (profile `edge`) | 128 MB |

Volumes: `data` (banco, logins do Claude/GitHub, configurações), `workspace` (projetos e
agentes), `browser-profile` (perfil do navegador dos agentes), `caddy-*` (certificados).

## Passo a passo

1. **DNS**: crie um registro A do domínio do painel para o IP da VPS.
2. **Docker**: <https://docs.docker.com/engine/install/> (inclui o plugin compose).
3. **Instalar**: `sudo ./install.sh` na pasta do projeto.
   - `--env-only` só gera o `.env` para você revisar antes de subir.
   - `--yes` usa variáveis de ambiente em vez de perguntas:
     `ATRIA_DOMAIN`, `ACME_EMAIL`, `OPENAI_API_KEY`, `ATRIA_USER_NAME`, `ATRIA_PROXY`.
   - Rodar de novo é seguro: valores existentes no `.env` são mantidos.
4. **Primeiro acesso**: abra o domínio, crie a senha e siga **Configurações › Primeiros passos**.

## Proxy HTTPS

- **Sem proxy na VPS** (`ATRIA_PROXY=caddy`): o Caddy ocupa as portas 80 e 443 e emite o certificado
  sozinho (`ACME_EMAIL` obrigatório).
- **Traefik já rodando** (`ATRIA_PROXY=traefik`): o serviço `atria` publica labels para ele. Se o seu
  Traefik usa outros nomes, defina no `.env`:
  `ATRIA_TRAEFIK_ENTRYPOINT=<entrypoint https>` e `ATRIA_TRAEFIK_CERTRESOLVER=<resolver acme>`.
  O Traefik precisa enxergar containers pelo provider Docker.
- **Outro proxy** (nginx etc.): aponte para `atria:8080` sem buffer de resposta
  (o painel usa SSE e WebSocket) e use `ATRIA_PROXY=traefik` para não subir o Caddy.

## Conectar contas (pelo painel)

- **Claude**: Configurações › Conexões › *Conectar conta Claude* abre um terminal no próprio painel.
  Digite `/login`, escolha a conta claude.ai, abra o link, autorize e cole o código; `/exit` no fim.
  O login fica no volume `data` e traz os conectores MCP, skills e plugins da sua conta.
- **GitHub**: *Conectar GitHub* roda `gh auth login` — abra o link, digite o código de 8 letras.
- **OpenAI**: cole a chave de API; o painel testa antes de salvar.
- Conectores que pedem autorização (Facebook, Stripe, n8n…) são autorizados em
  <https://claude.ai/settings/connectors>.

## Configurações

Tudo que está em **Configurações** (nome, e-mail, voz, modelos, concorrência de agentes, aprovações)
fica salvo no banco e tem prioridade sobre o `.env`. O `.env` é só o ponto de partida da instalação.

## Atualizar, backup e restauração

```bash
sudo ./install.sh --update   # git pull + rebuild, esperando execuções em andamento terminarem
sudo ./install.sh --backup   # ./backups/atria-AAAAMMDD-HHMM.tgz + cópia do .env
```

Restaurar numa VPS nova: instale normalmente, pare o `atria` (`docker compose stop atria`),
extraia o backup nos volumes (`docker run --rm -v atria-os_data:/data -v atria-os_workspace:/workspace -v $PWD/backups:/in alpine tar xzf /in/<arquivo>.tgz -C /`),
renomeie `/data/atria-backup.db` para `/data/atria.db` e suba de novo.

## Problemas comuns

- **Certificado não sai**: confira o DNS (`getent hosts <domínio>`) e se as portas 80/443 estão livres
  (`ss -ltn`). Logs: `docker compose logs atria-caddy`.
- **Agentes não rodam**: Configurações › Sistema mostra o estado do Claude; reconecte a conta.
- **Sem voz**: precisa da chave OpenAI com acesso ao modelo de voz (Configurações › Conexões › Testar chave).
- **Logs gerais**: `docker compose logs -f atria`.


Ver também: [[Atria OS]], [[Arquitetura]].
