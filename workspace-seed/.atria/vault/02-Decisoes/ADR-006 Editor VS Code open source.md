---
tipo: decisão
status: aceita
tags: [adr]
---
# ADR-006 Editor VS Code open source

## Contexto
O usuário quer ver e editar os arquivos sem que um editor seja construído do zero.

## Decisão
openvscode-server num sidecar (atria-code), servido em /code pelo Atria OS, que checa a sessão; workspace com o vault e os projetos; extensão Foam para os links entre notas.

## Consequências
Mais um container (~400 MB de RAM); no celular o vault abre em modo leitura.

Relacionadas: [[Vault & Cérebro]], [[Aprovações e segurança]], [[Frontend]]
