---
tipo: arquitetura
tags: [projeto, arquitetura]
---
# Arquitetura

- **yui-console**: Fastify 5 + TypeScript rodando direto no Node 24 (`node server/src/index.ts`), SQLite (better-sqlite3), SSE para eventos. Web em Vite + React servida pelo mesmo processo.
- **yui-browser**: Chromium com CDP + Playwright MCP; o console transmite a tela ao vivo.
- **yui-code**: VS Code open source (openvscode-server) servido em `/code` atrás do login — [[ADR-006 Editor VS Code open source]].
- **yui-dockerproxy**: Docker API somente leitura para Infra/Logs.
- Volume `yui-workspace` montado em `/workspace`: projetos, agentes (`.claude/agents`), workflows, relatórios e o vault (`.yui/vault`) — [[ADR-005 Vault em .yui]].
- Configurações editáveis pelo painel ficam no banco — [[ADR-004 Configurações no banco]].
- Execuções usam o Claude Agent SDK com `canUseTool`: comandos sensíveis viram aprovação — [[Aprovações e segurança]].

Agentes que mais mexem aqui: [[Backend]], [[Frontend]], [[DevOps]].
