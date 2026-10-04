---
titulo: Operações
grupo: Acompanhar
pagina: ops
ordem: 2
resumo: Quadro ao vivo de quem está fazendo o quê, do pedido até a entrega, com linha do tempo das últimas 24 horas.
usar_quando: Quando vários agentes estão trabalhando e você quer ver o andamento em tempo real ou achar o que travou.
nao_usar_quando: Para buscar uma execução antiga ou filtrar por projeto, use Execuções.
frases:
  - "Yui, quem está trabalhando agora?"
  - "Me mostra as execuções em andamento."
  - "O que está esperando por mim?"
dicas:
  - A coluna "Aguardando você" mostra aprovações; clicar num cartão dela abre o modal de aprovação.
  - O quadro atualiza sozinho quando uma execução ou aprovação muda.
  - Na "Linha do tempo · 24h", clique no nome do agente para abrir a ficha dele.
erros:
  - Achar que um cartão em "Na fila" travou. Ele espera vaga: o número de agentes ao mesmo tempo é limitado (Configurações › Modelos).
relacionados: [visao-geral, execucoes, agentes, aprovacoes]
---
# Operações

## O que é
Mostra o caminho de cada pedido: Entrada (você) › Conversa (Yui) › Decide (Cérebro) › Planeja (missões e workflows) › Executa (agentes) › Controle (aprovação) › Resultado (entrega). Abaixo, um quadro com as execuções por estado e uma linha do tempo por agente.

## Passo a passo
1. **Leia a faixa do topo.** Cada etapa mostra os números do dia; as acesas têm atividade agora.
2. **Varra o quadro.** Colunas Na fila, Rodando, Aguardando você, Concluído hoje e Falhou.
3. **Abra um cartão.** Clique para ver a execução (ou a aprovação, se estiver em Aguardando você).
4. **Veja o ritmo do dia.** A "Linha do tempo · 24h" mostra quando cada agente trabalhou; passe o mouse num bloco para ver a tarefa.
5. **Pule para o detalhe.** Os botões Execuções e Agentes no topo levam às telas completas.

## O que você vê na tela
- Cartão: agente, tarefa, origem (Yui, missão, workflow, rotina), projeto e barra de progresso.
- Cores na linha do tempo: azul rodando, âmbar esperando aprovação, vermelho falha.

## Exemplos do dia a dia
- Uma missão parece parada → procure a etapa em "Aguardando você" e aprove.
- Muitas falhas vermelhas no mesmo agente → abra o agente e veja as últimas execuções.
- Fila crescendo → aumente "Agentes ao mesmo tempo" em Configurações › Modelos.
