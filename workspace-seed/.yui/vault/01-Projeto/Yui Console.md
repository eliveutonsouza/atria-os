---
tipo: produto
status: no ar
tags: [projeto, yui]
dominio: (o domínio desta instalação)
---
# Yui Console

Central pessoal de IA. Você conversa com a **Yui** (voz ou texto) e ela organiza o trabalho de uma equipe de agentes **Claude Code** rodando na VPS: abre telas, cria planos, delega tarefas, roda workflows agendados e mostra os resultados.

## Partes
- Conversa: [[Voz GPT-Live]] (full-duplex) e texto; o cérebro roteia pedidos — ver [[ADR-001 Voz pela OpenAI]].
- Agentes: Claude Code com a conta do usuário — [[Agentes]].
- Segurança: [[Aprovações e segurança]].
- Dashboard v3, navegador ao vivo, terminal e [[PWA e push]].
- Conhecimento: [[Vault & Cérebro]].
- Como está montado: [[Arquitetura]]; como instalar: [[Instalação]].
- Próximos passos: [[Roadmap]].

## Decisões que moldaram o produto
- [[ADR-002 Independente do Company OS]]
- [[ADR-003 Projetos são repos do GitHub]]
- [[ADR-004 Configurações no banco]]
- [[ADR-005 Vault em .yui]]
- [[ADR-006 Editor VS Code open source]]
