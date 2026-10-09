---
titulo: Workflows
grupo: Organizar
pagina: workflows
ordem: 2
resumo: Processos de trabalho que se repetem, desenhados como fluxograma com tarefas, decisões, aprovações, avisos e pedidos de informação, para rodar quando quiser ou em horário marcado.
usar_quando: Quando você faz o mesmo processo várias vezes (leads, posts, revisão semanal) e quer que ele rode sempre igual.
nao_usar_quando: Para um projeto único com várias entregas, use Missões; para uma instrução simples recorrente de um agente, use Agendamentos.
frases:
  - "Yui, cria um workflow que toda segunda pesquisa tendências, escreve um post pro Instagram, pede minha aprovação e publica."
  - "Roda o workflow de leads agora."
  - "Agenda o workflow de leads para dias úteis às 8h."
  - "Como está desenhado o workflow do Instagram?"
  - "Exclui o workflow de leads."
  - "Tem algum workflow esperando resposta minha?"
  - "Abre o pedido do workflow de leads."
dicas:
  - Workflows rodam no automático. Passos de Aprovação são decididos pela Yui com base nas suas decisões anteriores; marque "Sempre me perguntar" no passo quando quiser decidir você.
  - Na aba Execuções, Concordo/Discordo numa aprovação decidida pela Yui ensina o critério para as próximas.
  - Em cada Tarefa, preencha Nome da saída; os passos seguintes usam esse resultado.
  - A aba Markdown é o mesmo texto que os agentes leem. Dá para copiar, colar e editar por ali.
  - Use **Pedir informação** quando o fluxo precisa de algo seu no meio do caminho (data, gravação da reunião, fotos). Ele para, te avisa e espera sem prazo, mesmo se o servidor reiniciar.
  - Use **Avisar** para mandar o resultado por Telegram, e-mail ou push sem parar o fluxo. Configure os canais em Configurações › Avisos.
erros:
  - Mexer no fluxograma e sair sem Salvar.
  - Criar uma Decisão para checar se a aprovação foi dada. Não precisa: aprovação rejeitada já interrompe o workflow.
  - Usar Aprovação para pedir um arquivo ou uma data. Aprovação é só sim ou não; para receber conteúdo, use Pedir informação.
relacionados: [agendamentos, aprovacoes, missoes, avisos]
---
# Workflows

## O que é
Um workflow é um processo com passos: Tarefa (um agente executa), Decisão (uma condição em linguagem natural escolhe o ramo), Aprovação (você revisa), Pedir informação (o fluxo para e espera algo seu), Avisar (manda uma mensagem e segue), Paralelo (vários passos ao mesmo tempo) e Fim. Ele fica salvo como markdown com um fluxo em Mermaid e roda manualmente ou por agendamento.

## Passo a passo
1. **Crie.** Na lista, descreva o processo na caixa e clique em **Criar com a Yui** (ou Ctrl/⌘ Enter), ou use **+ Novo workflow** para começar do zero. Também dá para pedir por voz.
2. **Ajuste no editor.** Clique num passo e edite na aba **Propriedades**: Título, Agente, Instrução, Conectores / MCP, Skills e Nome da saída (Tarefa); O que revisar (Aprovação); Condição e Ramos (Decisão). Em Pedir informação: O que pedir, Campos e Quando parar, avisar por. Em Avisar: Por onde, Mensagem, Anexar arquivos gerados e Enviar um teste agora. Os botões Tarefa, Decisão, Aprovação, Pedir informação, Avisar, Paralelo e Fim adicionam passos.
3. **Salve.** O botão do topo mostra **Salvar** enquanto há mudanças.
4. **Rode.** **Rodar agora** executa e destaca o passo atual; **Parar execução** interrompe. A aba **Execuções** guarda o histórico.
5. **Agende.** **Agendar** mostra opções como Todo dia 8h, Dias úteis 8h, Toda segunda 9h, Toda sexta 17h, A cada hora, Dia 1 do mês 9h ou um cron personalizado. **Manual** tira o agendamento.
6. **Remova.** **Remover** no card da lista (ou **Excluir workflow** no editor) pede confirmação e apaga o workflow, as rotinas agendadas dele e o histórico de execuções. Se pedir à Yui, ela abre uma aprovação vermelha e só exclui se você clicar em **Excluir definitivamente**. Não dá para desfazer.

## Aprovações que aprendem
Num passo de Aprovação, a Yui lê o que revisar, os resultados da execução e as suas decisões anteriores naquele workflow, e aprova ou para a execução sozinha. Se não tiver certeza, chama você no modal; a sua resposta vira lição. Na aba **Execuções**, o passo mostra "Decidido pela Yui" com **Concordo** e **Discordo**. Discordar não desfaz a execução, mas muda as próximas decisões. Criando pela Yui, o passo de aprovação só entra se você pedir ("me pede OK antes de publicar") e já vem com "Sempre me perguntar".

## Pedir informação: o fluxo para e espera você
1. **Monte os campos.** No passo, clique em **+ Campo** e escolha o tipo: texto, texto longo, data, hora, número, sim/não, escolha, áudio, imagens ou arquivos. Marque **obrigatório** e, em data e hora, **padrão hoje**. Em escolha, escreva as opções separadas por vírgula.
2. **Escolha por onde avisar.** Telegram, Push e E-mail. Pelo Telegram dá para responder lá mesmo.
3. **Responda.** Quando o fluxo chega no passo, você recebe o aviso com o link do formulário. Ele também aparece nas Pendências e na aba **Execuções** com **Responder agora** e **Lembrar de novo agora**. No formulário: **Hoje** preenche a data, **Gravar agora** grava pelo microfone e dá para escolher arquivos de áudio (mp3, m4a, wav, ogg, webm, mp4) até 500 MB. **Enviar e continuar** manda tudo; **Depois** fecha sem responder; **Cancelar execução** encerra o fluxo.
4. **Pelo Telegram.** Responda a mensagem do bot com a gravação, fotos ou texto ("fechou sim, reunião hoje"). O bot diz o que já recebeu e o que falta e, com tudo pronto, mostra **Enviar e continuar**. O Telegram só baixa arquivos de até 20 MB; maiores vão pelo formulário.
5. **Depois de enviar.** O áudio é transcrito em partes e resumido (tópicos, decisões, valores, prazos, próximos passos). O andamento aparece na aba Execuções. Os passos seguintes recebem as respostas, o resumo e o caminho da transcrição completa; a Decisão pode usar as respostas ("fechou = sim").

Sem resposta, o pedido espera sem prazo e lembra a cada 24 h (ajuste em Configurações › Avisos). Reiniciar o servidor não perde o pedido.

## Avisar: manda e segue
O passo Avisar manda uma mensagem pelos canais escolhidos e passa para o próximo passo na hora. Em **A Yui escreve**, ela resume os passos anteriores seguindo a sua instrução. Em **Texto fixo**, use marcadores como `{{Criar site demo}}` (o título do passo) ou `{{Criar site demo.saida}}`. **Anexar arquivos gerados** manda até 5 arquivos produzidos na execução. Falha no envio vira uma nota na execução e não trava o fluxo.

## O que você vê na tela
- Fluxograma no centro; arraste do ponto inferior do losango até outro passo para criar um ramo.
- Abas Propriedades, Markdown, Mermaid (com Copiar Mermaid) e Execuções.
- Copiar markdown e Colar markdown, para duplicar ou trazer um workflow de outro lugar.
- Na lista: gatilho, time de agentes, última execução e os botões Abrir, Rodar, Agendar e Remover.
- Execução parada num Pedir informação: o passo pisca e a aba Execuções mostra o cartão **Esperando sua resposta**.

## Exemplos do dia a dia
- Leads toda manhã → workflow com Research buscando e qualificando, decisão "tem leads bons?" e registro no CRM pelo Assistente.
- Post semanal → pesquisa, legenda (Copy), arte (Designer), decisão de qualidade, aprovação sua e publicação.
- Revisão semanal dos repositórios → agendado para segunda e entregue pelo Report.
- Lead do dia → site demo → Avisar no Telegram → Pedir informação com a gravação da reunião → proposta com o que foi combinado.
