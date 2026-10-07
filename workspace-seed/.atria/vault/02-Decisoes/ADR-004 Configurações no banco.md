---
tipo: decisão
status: aceita
tags: [adr]
---
# ADR-004 Configurações no banco

## Contexto
Trocar chave, modelo ou senha exigia editar o .env e reiniciar.

## Decisão
Configurações editáveis ficam na tabela settings; o banco tem precedência sobre o .env.

## Consequências
Painel de configurações; primeiro acesso cria a senha.

Relacionadas: [[Arquitetura]]
