---
titulo: Missões
grupo: Organizar
pagina: missions
ordem: 1
resumo: Para pedidos grandes, a Yui monta um plano com várias etapas e agentes, roda na ordem certa e para nas etapas arriscadas.
usar_quando: Quando o pedido envolve mais de uma especialidade ou várias entregas (site completo, auditoria, campanha, pesquisa mais conteúdo).
nao_usar_quando: Para algo que se repete sempre do mesmo jeito, use Workflows; para uma tarefa simples de um agente, só peça à Yui.
frases:
  - "Yui, cria uma landing page para uma clínica de fisioterapia no projeto clinica-site."
  - "Faz uma auditoria completa de segurança e desempenho do Stoqmate."
  - "Como está a missão?"
  - "Pausa a missão."
  - "Tenta de novo a etapa que falhou."
  - "Exclui a missão da landing page."
dicas:
  - Diga tudo no primeiro pedido (público, tom, referências, projeto). Cada etapa recebe uma instrução fechada e não ouve a conversa.
  - Etapas sem dependência rodam em paralelo; as que dependem recebem o resultado das anteriores.
  - A missão roda no automático, inclusive deploy e envio. Se quiser revisar uma etapa, marque "Pedir meu OK antes de" na tela de criação ou peça: "me pede OK antes de publicar".
  - Pela tela **+ Nova missão** nada roda até você clicar em **Iniciar missão**: dá para revisar e ajustar cada etapa antes.
erros:
  - Usar missão para uma tarefa pequena. Ela vira 2 a 8 etapas e gasta mais do que uma delegação direta.
  - Esquecer o projeto. Sem projeto, as etapas trabalham numa pasta de rascunho do workspace.
relacionados: [workflows, aprovacoes, execucoes, projetos]
---
# Missões

## O que é
Uma missão é um plano de execução: o objetivo vira de 2 a 8 etapas, cada uma com um agente, ligadas por dependências. Pedindo à Yui, o plano aparece na tela e começa sozinho. Pela tela **+ Nova missão** ele fica como **rascunho** até você iniciar. Você acompanha cada etapa e o grafo mostra o que já terminou.

## Passo a passo
1. **Peça algo grande.** Fale com a Yui (começa na hora) ou clique em **+ Nova missão** para montar com calma.
2. **Na tela de criação, diga o que você quer.** Preencha o objetivo, escolha o projeto (ou "Sem projeto"), escreva detalhes e referências (público, tom, cores, links, o que evitar) e marque **Pedir meu OK antes de** publicar/deploy e/ou enviar mensagem ou e-mail.
3. **Planeje com a Yui ou monte à mão.** **Planejar com a Yui** gera as etapas no quadro ao lado; **monte as etapas à mão** cria um rascunho vazio e você adiciona com **+ Etapa**. **Replanejar** refaz o plano com o pedido atual (substitui as etapas).
4. **Ajuste as etapas.** Clique numa etapa no quadro para mudar título, agente, instrução, dependências (chips com ✕ e "depender de outra etapa") e "Pedir meu OK antes desta etapa". Arrastar do ponto da direita de uma etapa até outra cria a dependência; ligações em círculo são recusadas. **Excluir etapa** pede confirmação.
5. **Salve ou inicie.** **Salvar rascunho** guarda tudo sem executar (o rascunho aparece na lista como "rascunho" e reabre no editor). **Iniciar missão** salva e começa a executar. **Descartar** apaga o rascunho, com confirmação.
6. **Confira o plano.** A missão abre com as Etapas, o agente de cada uma e o estado (na fila, trabalhando, aguardando seu OK, concluída, falhou, pulada).
7. **Aprove só o que você pediu.** Etapas em que você pediu aprovação ficam "aguardando seu OK" até você decidir em Aprovações; o resto segue sozinho.
8. **Controle o andamento.** Botões **Pausar**, **Retomar**, **Cancelar** e, se algo falhar, **Tentar de novo**. Com a missão pausada ou precisando de você, **Editar etapas** abre o editor só para as etapas que ainda estão na fila (as que já rodaram ficam apagadas e não mudam).
9. **Veja as entregas.** Clique numa etapa para abrir a execução e o resultado.
10. **Exclua o que não serve mais.** A lixeira na lista (ou **Excluir** no topo da missão) pede confirmação; etapas em andamento são canceladas antes. Pedindo à Yui, ela abre uma aprovação vermelha e só exclui se você clicar em **Excluir definitivamente**. Os runs dos agentes continuam em Execuções.

## O que você vê na tela
- Tela de criação (+ Nova missão ou um rascunho): "1. O que você quer" à esquerda e "2. Revise o plano" à direita, com o quadro de etapas e o painel da etapa selecionada. No celular, abas **Pedido · Etapas · Fluxo**; tocar numa etapa abre o painel numa folha inferior.
- Lista de missões à esquerda: título, estado (rascunho, rodando, pausada, precisa de você, concluída, falhou, cancelada), agentes e "x/y etapas", com a lixeira para excluir.
- Plano à direita com grafo das etapas e a lista detalhada.
- "Precisa de você": há etapa falhada ou aprovação pendente.

## Exemplos do dia a dia
- Novo cliente quer site → missão com Designer, Copy, Frontend e QA, até o deploy, sem parar (diga "me pede OK antes do deploy" se quiser revisar).
- Auditoria antes de entregar um sistema → missão com Security, QA e Report.
- Uma etapa falhou por falta de acesso → resolva o acesso e diga "tenta de novo a missão".

## Concluída com ressalvas
Ao terminar, a missão confere sozinha (sem gastar IA) se alguma etapa terminou sem resultado, falou em falha, parou no limite de turnos ou pedia um arquivo sem entregar nenhum. Se achar algo, a missão mostra **Concluída com ressalvas · vale conferir** com a lista, e a Yui avisa.
