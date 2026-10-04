---
tipo: decisão
status: aceita
tags: [adr]
---
# ADR-001 Voz pela OpenAI

## Contexto
O usuário queria a mesma voz da conversa do ChatGPT, não um pipeline caseiro de STT+TTS.

## Decisão
Usar o GPT-Live na API (WebRTC no navegador + canal lateral no servidor) e delegar o raciocínio a um cérebro com ferramentas.

## Consequências
Voz natural e baixa latência; o GPT-Live às vezes responde sem delegar, o que exigiu o watchdog.

Relacionadas: [[Voz GPT-Live]], [[Yui Console]]
