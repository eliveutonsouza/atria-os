---
titulo: Consumo de IA
grupo: Sistema
pagina: usage
ordem: 3
resumo: Quanto do limite do plano Claude você já usou, quando ele reinicia e quanto a OpenAI custou hoje, na semana e no mês, por função e por agente.
usar_quando: Para saber se ainda dá para mandar trabalho pesado para os agentes hoje, ou para acompanhar o gasto com a OpenAI (voz, cérebro, planejamento, empresa).
nao_usar_quando: Para ver o que cada execução fez, use Execuções; para trocar modelos ou preços, use Configurações › Modelos.
frases:
  - "Yui, quanto gastei de IA essa semana?"
  - "Quanto falta do limite do Claude?"
  - "Quando reinicia a sessão do Claude?"
  - "Quanto a OpenAI custou hoje?"
dicas:
  - Os limites do Claude são lidos durante as execuções e a cada 10 minutos. Para ver o número exato agora, toque em Atualizar limites.
  - Barra âmbar a partir de 80% e vermelha a partir de 95%. Perto do limite, deixe as tarefas grandes para depois do reinício.
  - Se aparecer "Sem preço para …", o modelo não está na tabela de preços. Defina o preço em Configurações › Modelos para o custo aparecer.
  - O custo do Claude Code é o equivalente em API. Na assinatura Max ou Pro você não paga por execução; o que conta é a porcentagem do limite.
erros:
  - Achar que o custo equivalente do Claude Code é cobrado. Na assinatura, ele só serve para comparar o peso de cada agente.
  - Olhar só o período "Hoje" e esquecer o limite semanal, que reinicia em outro horário.
relacionados: [visao-geral, execucoes, configuracoes, agentes]
---
# Consumo de IA

## O que é
A página reúne os dois lados do gasto com inteligência artificial. Do lado do **Claude Code**, mostra os limites do seu plano (sessão de 5 horas e semana, por modelo), quanto do contexto a última execução ocupou e quantas execuções, tokens e custo equivalente cada agente gerou. Do lado da **OpenAI**, cada chamada da Yui (voz, cérebro, planejador, workflows, empresa) é medida na hora e somada por função e modelo.

## Passo a passo
1. **Abra.** No menu, entre em **Consumo de IA**, ou toque no card **Consumo de IA** da Visão geral.
2. **Escolha o período.** **Hoje**, **7 dias** ou **30 dias** (seletor no topo; no celular, os três botões logo abaixo do título).
3. **Atualize os limites.** **Atualizar limites** lê agora a sessão e a semana do plano Claude. A página também se atualiza sozinha a cada minuto.
4. **Confira o Claude Code.** Cada barra mostra a porcentagem usada e quando reinicia ("reinicia em 2 h 14 min" ou "reinicia seg 09:00").
5. **Confira a OpenAI.** Veja o custo de hoje, 7 e 30 dias e as barras por função, com o modelo e os tokens ou minutos de voz.
6. **Corrija preços que faltam.** Se aparecer o aviso "Sem preço para …", toque nele e defina o preço em **Configurações › Modelos**.

## O que você vê na tela
- Cartão **Claude Code**: plano e modelo, barras de limite (âmbar a partir de 80%, vermelha a partir de 95%), contexto da última execução com agente e tarefa, e os números de execuções, tokens e custo equivalente.
- Cartão **OpenAI API**: custo hoje, 7 dias e 30 dias, e barras por função com modelo, tokens ou minutos de voz e custo (ou "sem preço").
- **Custo por dia**: colunas empilhadas, Claude Code em lilás e OpenAI em verde. No celular, toque numa coluna para ver os valores do dia.
- **Claude Code por agente**: execuções, tokens e custo de cada agente. Toque numa linha para abrir o agente.
- Na **Visão geral**, o card **Consumo de IA** resume a sessão de 5 h, a semana e o gasto da OpenAI hoje.

## Exemplos do dia a dia
- Antes de mandar uma missão grande → olhe a sessão de 5 h; se estiver acima de 80%, espere o reinício ou divida a missão.
- Fim do mês → período **30 dias** para ver quanto a voz e o cérebro custaram e qual agente mais pesou.
- Pergunta rápida por voz → "Yui, quanto falta do limite do Claude?" e ela responde com a porcentagem e o horário de reinício.

## Limites automáticos
Em Configurações › Agentes & aprovações › Limites e segurança:
- **Avisar em (%)**: quando a janela de 5 h ou a semana do Claude passa disso, a Yui avisa (uma vez por janela).
- **Pausar automáticas em (%)**: acima disso, rotinas e workflows disparados por rotina esperam na fila com "Aguardando limite do Claude (reinicia HH:MM)" e voltam sozinhos quando a janela reinicia. O que você pede na hora sempre roda. Você recebe aviso pela Yui, Telegram e push.
- **Teto diário OpenAI (US$)**: acima dele, workflows automáticos esperam o dia seguinte; a conversa com a Yui continua.
- **Teto por execução automática (US$)**: freio contra loop (estimativa do Claude Code). 0 = sem teto.
- "Yui, quanto falta do limite?" também diz quantas rotinas estão pausadas pelo limite.
