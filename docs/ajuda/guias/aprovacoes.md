---
titulo: Aprovações
grupo: Acompanhar
pagina: inbox
ordem: 5
resumo: Workflows, rotinas, missões e projetos rodam no automático. Aqui aparece só o que você pediu para aprovar, o que a Yui não teve certeza e as exclusões que você pediu a ela.
usar_quando: Quando um workflow chega num passo marcado "sempre me perguntar" ou que a Yui não soube decidir, quando uma missão chega numa etapa em que você pediu OK, ou quando você pede à Yui para excluir algo.
nao_usar_quando: Para ver o que já foi feito, use Execuções; esta tela só mostra o que está pendente.
frases:
  - "Yui, tem alguma aprovação esperando?"
  - "Abre a aprovação pendente."
  - "O que o DevOps quer executar?"
dicas:
  - Leia a linha Comando ou Detalhe antes de aprovar. Revisar abre a execução inteira para você ver o contexto.
  - Rejeitar não quebra nada. O agente é avisado, continua sem aquela ação e explica no resultado.
  - Aprovações não expiram com o tempo. Elas só somem se você decidir ou se a missão/workflow for cancelado.
  - Cada resposta sua num passo de workflow vira lição: a Yui passa a decidir sozinha casos parecidos.
  - Quer voltar a ser consultado antes de enviar/publicar/pagar por conectores? Ligue em Configurações › Agentes & aprovações.
erros:
  - Achar que os agentes vão parar para pedir licença. Eles rodam no automático; peça aprovação no pedido ("me pede OK antes de publicar") quando quiser revisar.
  - Esperar que a Yui aprove por você o que está aqui. Pendências do modal são suas; ela só decide sozinha dentro dos workflows.
relacionados: [celular, execucoes, missoes, workflows]
---
# Aprovações

## O que é
Por padrão tudo roda no automático: agentes fazem push, deploy, docker, enviam e publicam sem perguntar. O Atria OS só para em quatro casos:
- **Passo de Aprovação de workflow** marcado "Sempre me perguntar", ou em que a Yui não teve certeza. Nos demais, ela decide sozinha com base nas suas decisões anteriores naquele workflow.
- **Etapa de missão** em que você pediu aprovação no pedido.
- **Padrões do projeto** em atria.json › approvalPatterns. Valem para comandos que mudam algo (push, deploy, apagar, instalar); comandos só de leitura (echo, ls, cat, git status) o Claude Code libera sozinho e nunca pedem aprovação.
- **Exclusão de workflow ou missão** pedida à Yui (cartão vermelho).

Algumas ações nunca rodam, nem com aprovação: apagar a raiz, o home, o workspace ou /data inteiros, formatar disco, DROP DATABASE, prune do Docker, mexer nos stacks de produção protegidos (Twenty qcjv, Twenty jonyxmidia, n8n wesu) e force push na main/master. O agente é avisado e segue sem elas.

## Passo a passo
1. **Receba o aviso.** Aparece o modal "Aprovação necessária" no painel, o contador em "Aguardando você" e, se nenhuma tela estiver aberta, uma notificação no celular.
2. **Leia o pedido.** Título (quem quer fazer o quê) e linhas como Comando, Agente, Projeto, Ferramenta, Detalhe ou Etapa.
3. **Revise se tiver dúvida.** **Revisar** abre a execução com a timeline e o que já foi feito.
4. **Decida.** **Aprovar** deixa seguir; **Rejeitar** faz o agente continuar sem aquela ação. Numa missão, a etapa rejeitada é pulada junto com as que dependem dela; num workflow, a rejeição interrompe a execução.

## O que você vê na tela
- Cartões "APROVAÇÃO NECESSÁRIA" com tempo desde o pedido e os botões Revisar, Rejeitar e Aprovar.
- Cartões vermelhos "AÇÃO DESTRUTIVA · NÃO DÁ PARA DESFAZER" quando você pediu à Yui para excluir um workflow ou uma missão: **Cancelar** mantém tudo, **Excluir definitivamente** apaga.
- Outros avisos do inbox (entregas, falhas) logo abaixo; clique para abrir.
- "Nada precisa de você agora." quando está tudo em dia.

## Exemplos do dia a dia
- Workflow do Instagram chegou na revisão e a Yui não teve certeza → leia legenda e imagem e aprove; da próxima vez ela decide sozinha.
- "Cria uma missão para o site e me pede OK antes do deploy" → só a etapa de deploy para aqui.
- Você pediu "exclui o workflow teste" → cartão vermelho; Excluir definitivamente apaga.
- Para pedidos extras de um projeto (ex.: "npm run deploy"), o projeto pode listar padrões em atria.json › approvalPatterns.

## Lembrar a decisão
Em comando sensível de projeto e em ação de conector (enviar, publicar…), o card mostra **Lembrar esta decisão**. Marcado, **Aprovar** vira **Sempre permitir** e **Rejeitar** vira **Sempre bloquear**.
- Vale só para aquela ação exata (uma ferramenta de conector, ou comando + subcomando como `git push`), só para aquele agente e só naquele projeto.
- Comando encadeado (`&&`, `;`, `|`) nunca herda a regra e volta a pedir aprovação.
- Exclusões (cartão vermelho) e o que é sempre bloqueado por segurança nunca viram regra.
- Para ver ou remover: Configurações › Agentes & aprovações › Regras salvas, ou "Yui, o que eu liberei para os agentes?" / "volta a me pedir aprovação para o git push".
