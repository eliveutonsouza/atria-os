---
tipo: decisão
status: aceita
tags: [adr]
---
# ADR-005 Vault em .yui

## Contexto
O conhecimento precisava morar perto dos agentes e entrar no mesmo backup.

## Decisão
Vault Obsidian em /workspace/.yui/vault, versionado com git local e commit automático.

## Consequências
Agentes leem e escrevem com as ferramentas que já têm; o Cérebro indexa os links em memória.

Relacionadas: [[Vault & Cérebro]], [[Arquitetura]]
