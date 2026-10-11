---
titulo: Execuções
grupo: Acompanhar
pagina: runs
ordem: 4
resumo: O histórico de tudo que os agentes fizeram, com filtros, resultado, custo e o passo a passo de cada execução. Dá para excluir uma execução ou limpar as antigas.
usar_quando: Para achar o resultado de um pedido, entender por que algo falhou, cancelar uma execução em andamento ou apagar histórico antigo.
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
  - A lista começa com as 40 mais recentes; "Carregar mais" no fim traz as anteriores.
  - "Limpar antigas" (no topo; no celular fica no ⋯) apaga as terminadas há mais de 7, 30 ou 90 dias. Rodando, na fila ou aguardando você nunca são apagadas.
  - Uma falha que você já viu pode ser dispensada do inbox em Aprovações ("Dispensar"); ela continua aqui no histórico.
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
6. **Exclua.** **Excluir** no detalhe pede confirmação e apaga a execução com eventos e resultado. Se ela ainda estiver ativa, o agente é cancelado antes.
7. **Limpe o histórico.** **Limpar antigas** › escolha 7, 30 ou 90 dias › confirme.
8. **Veja mais.** **Carregar mais** no fim da lista busca execuções mais antigas.

## O que você vê na tela
- Estados: rodando (com %), na fila, aguardando você, concluído, falhou, cancelado.
- Colunas: Agente, Tarefa, Projeto, Estado, Quando.
- Detalhes técnicos: sessão e últimos eventos; erros em vermelho.

## Exemplos do dia a dia
- Cliente pergunta se o bug foi corrigido → filtre pelo projeto e leia o Resultado da última execução do Backend.
- Algo falhou de madrugada → filtre "falhou", abra e diga à Yui "tenta de novo corrigindo…".
- Agente demorando demais numa tarefa errada → Cancelar e peça de novo com instrução mais clara.
- Histórico poluído com testes antigos → Limpar antigas › 30 dias.

## Execução calada
Se uma execução fica sem nenhuma atividade por 20 min (ajustável em Configurações › Agentes & aprovações › Limites e segurança), a Yui avisa e a linha mostra "Sem atividade há N min". No dobro do tempo ela para, para liberar a vaga, e o resultado diz o motivo. Execuções esperando sua aprovação ou uma verificação no navegador não contam.

## Nota 👍/👎
No fim de cada execução concluída há 👍 e 👎. A nota entra no balanço por agente ("como foi minha semana?") e 👎 faz o agente revisar o que errou.
- Por voz: "essa ficou ruim" ou "gostei do relatório" (vale para a última execução concluída; a Yui confirma qual foi).

## Entregas (arquivos que os agentes geram)
Os arquivos que os agentes produzem aparecem em Artefatos › **Entregas dos agentes**, com a lista à esquerda (filtros Documentos, Imagens, Planilhas, Fixados, projeto e busca) e o arquivo aberto à direita: PDF, imagem, planilha CSV, Markdown e texto aparecem ali mesmo. No celular, a entrega abre em tela cheia.
- Entram sozinhos: o que cai na pasta da execução de workflow, os relatórios e as imagens novas do projeto (screenshots). Os agentes registram o resto (PDF, planilha, documento final).
- Cada linha tem **Abrir**, **Baixar**, **Telegram** (manda o arquivo no seu Telegram), **Execução** e **Fixar**.
- Entregas não fixadas saem da lista depois de 30 dias. Arquivos fora da pasta .atria do projeto nunca são apagados, só saem da lista.
- Por voz: "Yui, me manda o PDF que o agente fez ontem" ou "quais arquivos saíram hoje?".

## Refazer com outro modelo e comparar
Numa execução concluída, **Refazer com outro modelo** roda a mesma tarefa, com o mesmo agente, em outro modelo.
- Em projeto com git, a refeita trabalha numa cópia isolada do projeto e o original não muda. Sem git, ela só pode ler.
- Push, deploy, publicação e envios por conectores ficam bloqueados na refeita.
- **Comparar** mostra original e refeita lado a lado (modelo, tempo, turnos, custo, arquivos mudados e nota). **Ficar com a refeita** aplica as mudanças da cópia no projeto; **Descartar cópia** apaga a cópia. Cópias esquecidas saem em 7 dias.
- Por voz: "Yui, refaz isso com o Opus e compara".
