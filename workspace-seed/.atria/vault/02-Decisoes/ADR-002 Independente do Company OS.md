---
tipo: decisão
status: aceita
tags: [adr]
---
# ADR-002 Independente do Company OS

## Contexto
O Company OS é outro produto, com outro ciclo de deploy.

## Decisão
O Atria OS é uma stack própria em /docker/atria-os, sem dependência do Company OS.

## Consequências
Nada é compartilhado; o vault é exclusivo deste projeto.

Relacionadas: [[Atria OS]], [[Arquitetura]]
