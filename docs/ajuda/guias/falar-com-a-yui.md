---
titulo: Falar com a Yui
grupo: Começar
pagina: nenhuma
ordem: 1
resumo: A Yui é a porta de entrada: você pede por voz ou texto e ela abre telas, consulta dados e acorda os agentes certos.
usar_quando: Sempre que quiser algo feito, visto ou lembrado e não souber (ou não quiser procurar) qual tela usar.
nao_usar_quando: Para ajustes finos de configuração de um agente ou de um workflow, abra a tela direta (Agentes, Workflows) e edite lá.
frases:
  - "Yui, o que aconteceu enquanto eu estava fora?"
  - "Corrige o erro 500 no checkout do Stoqmate."
  - "Me mostra as execuções de hoje."
  - "Todo dia às 8h, pede pro Research uma lista de leads."
  - "Abre a aprovação pendente."
  - "Volta."
dicas:
  - Segure Espaço para falar e solte para enviar. Três toques rápidos no Espaço ligam a conversa contínua; um toque desliga.
  - Dê a instrução completa numa frase só (o quê, para quem, em qual projeto). O agente não ouve a conversa, só recebe o pedido que a Yui monta.
  - Ctrl/⌘ J alterna entre a Yui e o dashboard; Ctrl/⌘ K abre a lista de comandos; Ctrl/⌘ ` abre o terminal.
  - A voz é cobrada por segundo e encerra sozinha após alguns minutos parada (padrão 5, ajustável em Configurações › Yui & voz).
erros:
  - Pedir para a Yui aprovar algo. Ela nunca aprova sozinha; a decisão é sempre sua, no botão Aprovar.
  - Falar o nome do projeto de um jeito diferente do repositório. Se ela não reconhecer, diga "lista meus repositórios" e escolha.
relacionados: [visao-geral, aprovacoes, missoes, celular]
---
# Falar com a Yui

## O que é
A Yui é a assistente que conversa com você por voz (OpenAI GPT-Live) ou texto. Ela não faz o trabalho pesado sozinha: decide o que fazer, abre a tela certa e delega para os agentes Claude Code (Backend, Frontend, QA, DevOps, Security, Research, Copy, Designer, Report e Assistente). Antes de afirmar números ou status, ela consulta os dados reais do Atria OS.

## Passo a passo
1. **Escolha como falar.** Digite no campo "Pergunte ou segure espaço para falar…" e tecle Enter, ou segure **Espaço** e fale. O botão de microfone liga a conversa por voz contínua; clique de novo para encerrar.
2. **Peça o resultado, não o caminho.** Ex.: "Gera um relatório da semana do projeto X". A Yui escolhe o agente e diz em uma frase quem acordou.
3. **Acompanhe sem ficar parado.** O trabalho aparece em Operações e Execuções. Quando termina, a Yui avisa e você pode dizer "mostra o resultado".
4. **Decida as aprovações.** Se um agente quiser fazer algo sensível (push, deploy, enviar e-mail), aparece o modal de aprovação. Use **Revisar alterações**, **Aprovar** ou **Rejeitar**.
5. **Peça telas.** "Me mostra…", "abre…" e "volta" controlam o painel ao lado da Yui. "Tela cheia" amplia o painel.

## O que você vê na tela
- Orb da Yui: muda de estado (ouvindo, pensando, falando, aviso).
- Campo de mensagem: texto, botão de microfone e botão Enviar (↑).
- Painel ao lado (Canvas): as telas que a Yui abre, como execuções, projeto, logs ou o resumo de quando você esteve fora.
- Borda esquerda: passe o mouse para abrir o dashboard; o orb no canto volta para a conversa.

## Exemplos do dia a dia
- Chegou de manhã → "Yui, o que aconteceu enquanto eu estava fora?" (se você ficou mais de 4 horas fora, ela já abre com esse resumo).
- Bug reportado por cliente → "O formulário de contato do site da clínica não envia, investiga e corrige."
- Tarefa grande → "Cria uma landing page para uma clínica de fisioterapia." Ela monta uma missão com várias etapas.
- Lembrar uma decisão → "Anota no vault que vamos cobrar setup separado a partir de outubro."
