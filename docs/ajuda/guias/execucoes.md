---
titulo: Execuções
grupo: Acompanhar
pagina: runs
ordem: 4
resumo: O histórico de tudo que os agentes fizeram, com filtros, resultado, custo e o passo a passo de cada execução.
usar_quando: Para achar o resultado de um pedido, entender por que algo falhou ou cancelar uma execução em andamento.
nao_usar_quando: Para a foto do momento com todos os agentes, use Operações; para um plano de várias etapas, abra a missão.
frases:
  - "Yui, me mostra as execuções de hoje."
  - "O que o Backend fez no Stoqmate?"
  - "Por que a última execução do Research falhou?"
  - "Abre a última execução do Backend."
dicas:
  - Combine a busca com os filtros de agente, estado, projeto e origem (Yui/manual, missão, workflow).
  - "Ver resultado" abre a tela que o agente deixou (lista de leads, relatório, página). Nem toda execução deixa uma.
  - "Detalhes técnicos" mostra os últimos eventos brutos; útil para entender um erro.
erros:
  - Procurar uma execução de rotina pelo filtro de origem. Rotinas de agente entram como "Yui/manual"; filtre pelo agente ou busque pelo texto da tarefa.
relacionados: [operacoes, agentes, missoes, aprovacoes]
---
# Execuções

## O que é
Cada vez que um agente trabalha nasce uma execução. Esta tela lista todas, das ativas para as mais recentes, e mostra o detalhe da escolhida ao lado.

## Passo a passo
1. **Filtre.** Digite em "Buscar tarefa ou resultado…" e use os seletores Todos os agentes, Todos os estados, Todos os projetos e Toda origem.
2. **Abra uma execução.** Clique na linha. O detalhe mostra estado, tarefa, agente, projeto e origem.
3. **Leia o andamento.** Duração, Tokens, Custo, Operação atual (enquanto roda), Timeline de passos e ferramentas usadas.
4. **Veja o resultado.** O bloco Resultado traz o resumo do agente; **Ver resultado** abre a tela entregue e **Ver missão** volta ao plano, se for parte de uma.
5. **Pare se precisar.** Em execuções ativas, **Cancelar** interrompe o agente.

## O que você vê na tela
- Estados: rodando (com %), na fila, aguardando você, concluído, falhou, cancelado.
- Colunas: Agente, Tarefa, Projeto, Estado, Quando.
- Detalhes técnicos: sessão e últimos eventos; erros em vermelho.

## Exemplos do dia a dia
- Cliente pergunta se o bug foi corrigido → filtre pelo projeto e leia o Resultado da última execução do Backend.
- Algo falhou de madrugada → filtre "falhou", abra e diga à Yui "tenta de novo corrigindo…".
- Agente demorando demais numa tarefa errada → Cancelar e peça de novo com instrução mais clara.
