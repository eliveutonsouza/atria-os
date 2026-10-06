---
titulo: Aprovações
grupo: Acompanhar
pagina: inbox
ordem: 5
resumo: Tudo que é irreversível ou sai do servidor para e espera o seu OK aqui antes de acontecer.
usar_quando: Quando um agente, uma missão ou um workflow pede permissão para push, deploy, envio, publicação, pagamento ou exclusão.
nao_usar_quando: Para ver o que já foi feito, use Execuções; esta tela só mostra o que está pendente.
frases:
  - "Yui, tem alguma aprovação esperando?"
  - "Abre a aprovação pendente."
  - "O que o DevOps quer executar?"
dicas:
  - Leia a linha Comando ou Detalhe antes de aprovar. Revisar abre a execução inteira para você ver o contexto.
  - Rejeitar não quebra nada. O agente é avisado, continua sem aquela ação e explica no resultado.
  - Aprovações não expiram com o tempo. Elas só somem se você decidir ou se a missão/workflow for cancelado.
  - Os avisos de conectores (enviar e-mail, publicar, pagar, apagar…) podem ser desligados em Configurações › Agentes & aprovações; os comandos de terminal sensíveis sempre pedem.
erros:
  - Aprovar sem ler o comando. Um "docker" ou "rm -rf" no projeto errado é difícil de desfazer.
  - Esperar que a Yui aprove por você. Ela só mostra o pedido; o clique é seu.
relacionados: [celular, execucoes, missoes, workflows]
---
# Aprovações

## O que é
O console para e pergunta antes de ações sensíveis. Nos comandos de terminal dos agentes, pede OK para: git push, docker, rm -rf, deploy/publish/release, npm publish, ssh/scp/rsync/kubectl, curl com POST/PUT/DELETE/PATCH, merge e release no GitHub e acesso a banco (psql, mysql, DROP TABLE). Nos conectores, pede OK para ações como enviar, responder, encaminhar, apagar, publicar, fazer deploy, pagar, transferir, compartilhar, convidar e criar ou alterar eventos. Etapas de missão marcadas como arriscadas e passos de Aprovação em workflows também param aqui.

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
- DevOps quer rodar "git push origin main" no projeto certo → Aprovar.
- Assistente quer enviar e-mail para um cliente e o texto ainda não foi revisado → Revisar, depois Rejeitar e peça o rascunho.
- Workflow do Instagram chegou na revisão → leia legenda e imagem no resultado anterior e aprove.
- Para pedidos extras de um projeto (ex.: "npm run deploy"), o projeto pode listar padrões em yui.json › approvalPatterns.
