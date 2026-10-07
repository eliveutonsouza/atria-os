---
tipo: arquitetura
tags: [projeto, arquitetura]
---
# Arquitetura

- **atria**: Fastify 5 + TypeScript rodando direto no Node 24 (`node server/src/index.ts`), SQLite (better-sqlite3), SSE para eventos. Web em Vite + React servida pelo mesmo processo.
- **atria-browser**: Chromium com CDP + Playwright MCP; o Atria OS transmite a tela ao vivo.
- **atria-code**: VS Code open source (openvscode-server) servido em `/code` atrás do login — [[ADR-006 Editor VS Code open source]].
- **atria-dockerproxy**: Docker API somente leitura para Infra/Logs.
- Volume `workspace` montado em `/workspace`: projetos, agentes (`.claude/agents`), workflows, relatórios e o vault (`.atria/vault`) — [[ADR-005 Vault em .yui]].
- Configurações editáveis pelo painel ficam no banco — [[ADR-004 Configurações no banco]].
- Execuções usam o Claude Agent SDK com `canUseTool`: comandos sensíveis viram aprovação — [[Aprovações e segurança]].

Agentes que mais mexem aqui: [[Backend]], [[Frontend]], [[DevOps]].
