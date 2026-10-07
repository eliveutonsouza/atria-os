---
tags: [projeto, seguranca]
---
# Aprovações e segurança

- Agentes rodam no automático (push, deploy, docker, publicar, enviar). Só pedem aprovação no modal onde o usuário pediu: passo de workflow com "sempre me perguntar", etapa de missão com OK pedido, `atria.json › approvalPatterns`, ou conectores sensíveis se a opção estiver ligada.
- Passos de Aprovação de workflow são decididos pela Yui com base nas decisões anteriores do usuário (tabela `workflow_approval_decisions`); confiança < 0,7 chama o usuário.
- Bloqueio fixo (`server/src/safety.ts`): rm -rf da raiz/home/workspace/data, mkfs, dd em /dev, DROP DATABASE, docker prune, stacks protegidos, force push na main.
- Login com senha (argon2), cookie de sessão `httpOnly` + `SameSite=Strict`; tudo em `/api` exige sessão.
- O editor em `/code` só é alcançável pelo Atria OS, que checa a sessão antes de repassar — [[ADR-006 Editor VS Code open source]].
- Agente responsável por revisões: [[Security]].
