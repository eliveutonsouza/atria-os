# Yui Console

Central pessoal de IA. Você conversa com a **Yui** (voz ou texto) e ela organiza o trabalho de uma
equipe de agentes **Claude Code** rodando na sua VPS: abre telas, cria planos, delega tarefas,
roda workflows agendados e mostra os resultados. Quando preferir, use o **dashboard** completo
(sidebar na borda esquerda) — a Yui fica minimizada no canto, esperando você.

- **Conversa**: voz full-duplex (OpenAI GPT-Live) e texto; a Yui abre telas e delega para os agentes.
- **Agentes**: Claude Code com a sua conta (conectores MCP, skills e plugins dela), um navegador
  próprio para testar sites, terminal interativo e aprovação humana para tudo que é irreversível.
- **Dashboard**: visão geral com gráficos, operações ao vivo (quem faz o quê), agentes, execuções,
  missões, workflows, agendamentos, projetos do GitHub, navegador ao vivo, terminal,
  central de comandos do Claude Code, conectores e configurações.
- **App**: instalável no celular e no desktop (PWA), com notificações de aprovações e entregas.

## Requisitos

- VPS Linux com **Docker** 24+ e o plugin **docker compose** v2
- 4 GB de RAM (recomendado 8 GB), 15 GB livres em disco
- Um domínio (ou subdomínio) apontando para a VPS
- Conta **Claude** Pro/Max (os agentes usam ela) e uma chave de API da **OpenAI** (voz e cérebro da Yui)

## Instalação

```bash
git clone <este repositório> yui-console && cd yui-console
sudo ./install.sh
```

O instalador pergunta o domínio e o e-mail para o HTTPS, gera o `.env`, detecta se já existe um
Traefik na VPS (usa ele) ou sobe o Caddy com certificado automático, e sobe tudo.
Sem perguntas: `YUI_DOMAIN=yui.seudominio.com ACME_EMAIL=voce@seudominio.com sudo -E ./install.sh --yes`.

## Primeiro acesso

1. Abra `https://<seu domínio>` — a primeira tela pede para **criar a sua senha**.
2. Em **Configurações › Conexões**:
   - **Conectar conta Claude** — abre um terminal dentro do painel; digite `/login`, abra o link,
     autorize e cole o código. Pronto: agentes com os seus conectores, skills e plugins.
   - **OpenAI** — cole a chave de API (platform.openai.com). O plano ChatGPT não serve.
   - **GitHub** (opcional) — mesmo esquema pelo terminal; seus repositórios aparecem sozinhos em Projetos.
3. Instale como app (⌘K › Instalar app) e ative as notificações neste dispositivo.

A aba **Primeiros passos** das Configurações mostra o que falta.

## Dia a dia

- Fale com a Yui (segure **Espaço**, ou 3 toques para conversa contínua) ou digite.
- Passe o mouse na **borda esquerda** para abrir o dashboard; clique no orb no canto para voltar à conversa.
- `Ctrl/⌘ K` abre os comandos; ``Ctrl/⌘ ` `` abre o terminal.

## Atualizar e backup

```bash
sudo ./install.sh --update   # puxa a versão nova, espera execuções em andamento terminarem e reinicia
sudo ./install.sh --backup   # banco, logins e projetos em ./backups/ (guarde fora da VPS)
```

Detalhes, proxy existente, portas e solução de problemas: [docs/instalacao.md](docs/instalacao.md).
