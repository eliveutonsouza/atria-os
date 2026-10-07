---
tags: [projeto, voz]
---
# Voz GPT-Live

A conversa usa o sistema de voz da própria OpenAI (GPT-Live) via WebRTC no navegador, com um canal lateral no servidor em modo `delegation: client`. Pedidos viram chamadas ao cérebro (Responses API), que tem as ferramentas de tela e de trabalho.

- Espaço = push-to-talk; 3 toques rápidos = contínuo; botão do microfone = contínuo.
- Watchdog: fala que não gerou delegação em 2,5 s faz o servidor chamar o cérebro — ver [[Auditoria 2026-10-03]].
- Decisão: [[ADR-001 Voz pela OpenAI]].
- Pendente: teste de voz real do usuário.
