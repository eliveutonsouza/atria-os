---
tags: [projeto, seguranca]
---
# Aprovações e segurança

- Push, deploy, docker, `rm -rf`, publicar, enviar e-mail e afins pausam a execução e pedem aprovação no modal (ou no celular, via push).
- Conectores MCP sensíveis (send/publish/delete/pay) passam pelo mesmo modal.
- Login com senha (argon2), cookie de sessão `httpOnly` + `SameSite=Strict`; tudo em `/api` exige sessão.
- O editor em `/code` só é alcançável pelo console, que checa a sessão antes de repassar — [[ADR-006 Editor VS Code open source]].
- Agente responsável por revisões: [[Security]].
