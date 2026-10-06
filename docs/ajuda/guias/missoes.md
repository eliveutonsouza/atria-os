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
  - A missão roda no automático, inclusive deploy e envio. Se quiser revisar uma etapa, peça no pedido: "me pede OK antes de publicar".
erros:
  - Usar missão para uma tarefa pequena. Ela vira 2 a 8 etapas e gasta mais do que uma delegação direta.
  - Esquecer o projeto. Sem projeto, as etapas trabalham numa pasta de rascunho do workspace.
relacionados: [workflows, aprovacoes, execucoes, projetos]
---
# Missões

## O que é
Uma missão é um plano de execução: o objetivo vira de 2 a 8 etapas, cada uma com um agente, ligadas por dependências. O plano aparece na tela e começa sozinho. Você acompanha cada etapa e o grafo mostra o que já terminou.

## Passo a passo
1. **Peça algo grande.** Fale com a Yui ou clique em **+ Nova missão** (aqui ou na Visão geral) e descreva o objetivo.
2. **Confira o plano.** A missão abre com as Etapas, o agente de cada uma e o estado (na fila, trabalhando, aguardando seu OK, concluída, falhou, pulada).
3. **Aprove só o que você pediu.** Etapas em que você pediu aprovação ficam "aguardando seu OK" até você decidir em Aprovações; o resto segue sozinho.
4. **Controle o andamento.** Botões **Pausar**, **Retomar**, **Cancelar** e, se algo falhar, **Tentar de novo**.
5. **Veja as entregas.** Clique numa etapa para abrir a execução e o resultado.
6. **Exclua o que não serve mais.** A lixeira na lista (ou **Excluir** no topo da missão) pede confirmação; etapas em andamento são canceladas antes. Pedindo à Yui, ela abre uma aprovação vermelha e só exclui se você clicar em **Excluir definitivamente**. Os runs dos agentes continuam em Execuções.

## O que você vê na tela
- Lista de missões à esquerda: título, estado (rodando, pausada, precisa de você, concluída, falhou, cancelada), agentes e "x/y etapas", com a lixeira para excluir.
- Plano à direita com grafo das etapas e a lista detalhada.
- "Precisa de você": há etapa falhada ou aprovação pendente.

## Exemplos do dia a dia
- Novo cliente quer site → missão com Designer, Copy, Frontend e QA, até o deploy, sem parar (diga "me pede OK antes do deploy" se quiser revisar).
- Auditoria antes de entregar um sistema → missão com Security, QA e Report.
- Uma etapa falhou por falta de acesso → resolva o acesso e diga "tenta de novo a missão".
