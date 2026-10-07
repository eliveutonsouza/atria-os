---
tipo: decisão
status: aceita
tags: [adr]
---
# ADR-003 Projetos são repos do GitHub

## Contexto
O usuário tem cerca de 140 repositórios; manter uma lista à mão não escala.

## Decisão
O catálogo de projetos vem do `gh repo list` (usuário e organizações); repos com push recente são pré-clonados, os outros clonam sob demanda.

## Consequências
Login do gh dentro do container; busca fuzzy por nome.

Relacionadas: [[Atria OS]], [[Projetos]]
