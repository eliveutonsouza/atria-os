---
titulo: Agendamentos
grupo: Organizar
pagina: schedule
ordem: 3
resumo: O calendário da sua rotina automatizada: o que roda sozinho em cada dia e hora, e onde criar, pausar ou rodar rotinas.
usar_quando: Para ver o que vai rodar esta semana, criar uma rotina simples para um agente ou pausar algo por uns dias.
nao_usar_quando: Para desenhar um processo com vários passos e decisões, crie um workflow e depois agende.
frases:
  - "Yui, todo dia às 8h pede pro Research cinco leads de clínicas em Goiânia."
  - "Toda sexta às 17h, o Report faz o resumo da semana."
  - "Me mostra as rotinas agendadas."
dicas:
  - Os horários seguem o fuso de São Paulo.
  - Pausar mantém a rotina guardada; Ativar volta a rodar. Excluir apaga.
  - Rodar agora é o melhor jeito de testar uma rotina nova antes de esperar o horário.
erros:
  - Escrever a instrução da rotina vaga ("ver leads"). Ela roda sem você por perto; diga o que entregar e onde.
relacionados: [workflows, execucoes, visao-geral]
---
# Agendamentos

## O que é
Mostra as rotinas da semana num calendário. Uma rotina pode executar um workflow ou mandar uma instrução para um agente (com projeto opcional) em horário fixo. Quando chega a hora, o agente acorda, trabalha e volta a dormir.

## Passo a passo
1. **Navegue pela semana.** Use ‹ e › no topo; **Esta semana**/**Hoje** volta para a semana atual.
2. **Crie uma rotina.** **+ Nova rotina** leva ao cartão Rotinas. Escolha **Executar workflow** ou **Instrução para um agente**.
3. **Preencha.** Nome, Workflow (ou Agente, Projeto opcional e Instrução) e Quando: escolha um atalho (Todo dia 8h, Dias úteis 8h, Toda segunda 9h…) ou digite um cron. Clique em **Salvar rotina**.
4. **Gerencie.** Em cada rotina: **Rodar agora**, **Pausar**/**Ativar**, **Editar** e **Excluir**.
5. **Rode um workflow avulso.** Na coluna Workflows, **Abrir** ou **Rodar agora**.

## O que você vê na tela
- Calendário semanal com cada ocorrência por horário (no celular, a agenda do dia).
- Coluna Workflows com os passos de cada um.
- Bloco Hoje: o que já rodou (✓ ou !) e o que ainda vai rodar.
- Todas as rotinas, com próxima execução e último resultado.

## Exemplos do dia a dia
- Checagem de sites toda hora → Instrução para um agente, QA, "A cada hora".
- Relatório de sexta → Report, "Toda sexta 17h".
- Férias → Pausar as rotinas que geram trabalho para aprovar.

## Entrega e segurança das rotinas
No formulário da rotina:
- **Entregar o resultado**: Telegram, e-mail e/ou push. **Sempre**, **Só se mudou desde a última** (bom para monitorar preço, status, site) ou **Só se falhar**.
- **Pular o disparo se a anterior ainda estiver rodando** (ligado por padrão): rotina de 15 em 15 min não empilha execuções.
- **Se o Atria estava fora do ar no horário, rodar uma vez quando voltar**: recupera só o último disparo perdido nas últimas 24 h.
- Por voz: "todo dia às 8h checa o site do Stoq e me manda no Telegram só se mudar".
