---
titulo: Workflows
grupo: Organizar
pagina: workflows
ordem: 2
resumo: Processos de trabalho que se repetem, desenhados como fluxograma com tarefas, decisões e aprovações, para rodar quando quiser ou em horário marcado.
usar_quando: Quando você faz o mesmo processo várias vezes (leads, posts, revisão semanal) e quer que ele rode sempre igual.
nao_usar_quando: Para um projeto único com várias entregas, use Missões; para uma instrução simples recorrente de um agente, use Agendamentos.
frases:
  - "Yui, cria um workflow que toda segunda pesquisa tendências, escreve um post pro Instagram, pede minha aprovação e publica."
  - "Roda o workflow de leads agora."
  - "Agenda o workflow de leads para dias úteis às 8h."
  - "Como está desenhado o workflow do Instagram?"
  - "Exclui o workflow de leads."
dicas:
  - Workflows rodam no automático. Passos de Aprovação são decididos pela Yui com base nas suas decisões anteriores; marque "Sempre me perguntar" no passo quando quiser decidir você.
  - Na aba Execuções, Concordo/Discordo numa aprovação decidida pela Yui ensina o critério para as próximas.
  - Em cada Tarefa, preencha Nome da saída; os passos seguintes usam esse resultado.
  - A aba Markdown é o mesmo texto que os agentes leem. Dá para copiar, colar e editar por ali.
erros:
  - Mexer no fluxograma e sair sem Salvar.
  - Criar uma Decisão para checar se a aprovação foi dada. Não precisa: aprovação rejeitada já interrompe o workflow.
relacionados: [agendamentos, aprovacoes, missoes]
---
# Workflows

## O que é
Um workflow é um processo com passos: Tarefa (um agente executa), Decisão (uma condição em linguagem natural escolhe o ramo), Aprovação (você revisa), Paralelo (vários passos ao mesmo tempo) e Fim. Ele fica salvo como markdown com um fluxo em Mermaid e roda manualmente ou por agendamento.

## Passo a passo
1. **Crie.** Na lista, descreva o processo na caixa e clique em **Criar com a Yui** (ou Ctrl/⌘ Enter), ou use **+ Novo workflow** para começar do zero. Também dá para pedir por voz.
2. **Ajuste no editor.** Clique num passo e edite na aba **Propriedades**: Título, Agente, Instrução, Conectores / MCP, Skills e Nome da saída (Tarefa); O que revisar (Aprovação); Condição e Ramos (Decisão). Os botões Tarefa, Decisão, Aprovação, Paralelo e Fim adicionam passos.
3. **Salve.** O botão do topo mostra **Salvar** enquanto há mudanças.
4. **Rode.** **Rodar agora** executa e destaca o passo atual; **Parar execução** interrompe. A aba **Execuções** guarda o histórico.
5. **Agende.** **Agendar** mostra opções como Todo dia 8h, Dias úteis 8h, Toda segunda 9h, Toda sexta 17h, A cada hora, Dia 1 do mês 9h ou um cron personalizado. **Manual** tira o agendamento.
6. **Remova.** **Remover** no card da lista (ou **Excluir workflow** no editor) pede confirmação e apaga o workflow, as rotinas agendadas dele e o histórico de execuções. Se pedir à Yui, ela abre uma aprovação vermelha e só exclui se você clicar em **Excluir definitivamente**. Não dá para desfazer.

## Aprovações que aprendem
Num passo de Aprovação, a Yui lê o que revisar, os resultados da execução e as suas decisões anteriores naquele workflow, e aprova ou para a execução sozinha. Se não tiver certeza, chama você no modal; a sua resposta vira lição. Na aba **Execuções**, o passo mostra "Decidido pela Yui" com **Concordo** e **Discordo**. Discordar não desfaz a execução, mas muda as próximas decisões. Criando pela Yui, o passo de aprovação só entra se você pedir ("me pede OK antes de publicar") e já vem com "Sempre me perguntar".

## O que você vê na tela
- Fluxograma no centro; arraste do ponto inferior do losango até outro passo para criar um ramo.
- Abas Propriedades, Markdown, Mermaid (com Copiar Mermaid) e Execuções.
- Copiar markdown e Colar markdown, para duplicar ou trazer um workflow de outro lugar.
- Na lista: gatilho, time de agentes, última execução e os botões Abrir, Rodar, Agendar e Remover.

## Exemplos do dia a dia
- Leads toda manhã → workflow com Research buscando e qualificando, decisão "tem leads bons?" e registro no CRM pelo Assistente.
- Post semanal → pesquisa, legenda (Copy), arte (Designer), decisão de qualidade, aprovação sua e publicação.
- Revisão semanal dos repositórios → agendado para segunda e entregue pelo Report.
