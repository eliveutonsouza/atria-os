---
titulo: Usar pelo celular
grupo: Começar
pagina: nenhuma
ordem: 2
resumo: Instale o Atria OS como app no celular para receber avisos de aprovação, falhas e entregas e decidir na hora.
usar_quando: Quando você está longe do computador e quer acompanhar os agentes, aprovar um deploy ou pedir algo rápido.
nao_usar_quando: Para editar notas longas, desenhar workflows ou usar o VS Code do vault; isso funciona melhor no computador.
frases:
  - "Yui, tem alguma aprovação esperando?"
  - "Como está a missão do site da clínica?"
  - "Me mostra o que falhou hoje."
dicas:
  - No Android, use Configurações › Notificações › Instalar app. No iPhone, abra no Safari e use Compartilhar › Adicionar à Tela de Início; só assim o iPhone recebe notificações.
  - Depois de instalar, toque em Ativar notificações e em Enviar teste para confirmar que chega.
  - As notificações só são enviadas quando nenhuma tela do Atria OS está aberta e ativa; se você está olhando o painel, o aviso aparece nele.
erros:
  - Ativar notificações no navegador do iPhone sem instalar o app. Não funciona; instale primeiro.
  - Esperar notificação com o painel aberto no computador. Feche ou deixe o computador de lado e ela passa a chegar no celular.
relacionados: [aprovacoes, configuracoes, falar-com-a-yui]
---
# Usar pelo celular

## O que é
O Atria OS é um app instalável (PWA). No celular ele mostra versões compactas das telas e envia notificações push quando algo precisa de você: aprovação necessária, agente que não conseguiu concluir, entrega pronta, missão ou workflow terminado.

## Passo a passo
1. **Abra o endereço do Atria OS no celular** e entre com a sua senha.
2. **Instale o app.** Configurações › Notificações › **Instalar app** (ou ⌘K › "Instalar app (celular/desktop)"). No iPhone: Safari › Compartilhar › Adicionar à Tela de Início.
3. **Ative os avisos.** Na mesma seção, toque em **Ativar notificações** e depois em **Enviar teste**.
4. **Responda pelos avisos.** Tocar numa notificação de aprovação abre a tela Aprovações; tocar numa de execução abre o detalhe dela.
5. **Navegue pelas abas.** Embaixo ficam Início, Execuções, Workflows, Aprovações (com contador) e **Mais**, que mostra todas as telas em grade. No tablet, as mesmas telas ficam num trilho de ícones à esquerda.
6. **Use o ⋯ do topo.** Cada tela mostra a ação principal (ex.: Rodar, + Nova missão) e guarda o resto no **⋯**: salvar, agendar, ajuda e excluir (em vermelho, sempre com confirmação).
7. **Fale com a Yui.** Toque no orb (acima das abas) para digitar, ou em Mais › Falar com a Yui para a conversa por voz.

## O que você vê na tela
- Listas em cartões (missões, agentes, projetos, execuções); tocar abre o detalhe em tela cheia, com **‹** no topo para voltar (o gesto de voltar do celular também funciona).
- Aprovações e confirmações de exclusão sobem como uma folha da parte de baixo da tela, com os botões sempre visíveis.
- Terminal com uma faixa de teclas especiais (Esc, Tab, Ctrl, setas) acima do teclado; a tela encolhe junto com o teclado.
- Editor de workflow em abas (Fluxo, Passos, Markdown, Execuções); tocar num passo abre as propriedades embaixo.
- Execuções em cartões de três linhas (agente e estado, tarefa, projeto e tempo).
- Agendamentos como agenda do dia, com os 7 dias da semana em botões.
- Vault em lista › leitura, com botão Editar para ajustes simples (sem VS Code).
- Configurações › Notificações › Dispositivos inscritos: quais aparelhos recebem avisos.

## Exemplos do dia a dia
- Num almoço, chega "Aprovação necessária" → toque, leia o comando, toque em Aprovar.
- No trânsito, quer saber de uma missão → "Yui, como está a missão do site?" por voz.
- Chegou "Backend não conseguiu concluir" → toque para ver o resultado e diga "tenta de novo com…".
