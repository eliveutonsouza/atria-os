---
tipo: produto
status: em andamento
tags: [vault, cerebro, editor]
criado: 2026-10-04
---
# Vault & Cérebro

O vault é o cérebro do [[Yui Console]]: tudo que a Yui e os agentes aprendem vira nota em `/workspace/.yui/vault`, no formato do Obsidian.

## Como funciona
- Editor: [[ADR-006 Editor VS Code open source]] em `/code`, com o vault e os projetos lado a lado.
- Pasta e regras: [[ADR-005 Vault em .yui]].
- Lições dos agentes: cada agente tem sua nota em `03-Agentes` (ex.: [[Backend]], [[QA]]).
- Relatório de cada execução em `04-Execucoes`; nota do dia em `Diario`.
- Histórico em git local, com commit automático.
- O **Cérebro** desenha cada link como uma rota de luz; pastas viram galáxias; a **Constelação** mostra os vizinhos de 1º, 2º e 3º grau de uma nota.

## Galáxias
- `01-Projeto` — o produto
- `02-Decisoes` — ADRs
- `03-Agentes` — fichas e lições
- `04-Execucoes` — relatórios
- `05-Projetos` — repositórios
- `06-Ideias` — incubadora
- `Diario` — um dia por nota
