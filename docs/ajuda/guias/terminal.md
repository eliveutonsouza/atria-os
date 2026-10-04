---
titulo: Terminal
grupo: Ferramentas
pagina: terminal
ordem: 2
resumo: Um terminal dentro do console, com o Claude Code interativo ou um shell, em sessões que continuam vivas quando você fecha a tela.
usar_quando: Quando quer trabalhar lado a lado com o Claude num projeto, rodar um comando seu ou fazer logins (Claude, GitHub).
nao_usar_quando: Para tarefas que podem rodar sozinhas, peça à Yui; o agente trabalha em segundo plano e o resultado aparece em Execuções.
frases:
  - "Yui, abre o terminal."
  - "Como volto para uma sessão de terminal que eu fechei?"
  - "Como abro o Claude dentro de um projeto?"
dicas:
  - Ctrl/⌘ ` abre e fecha o terminal de qualquer lugar.
  - Fechar a tela só desconecta. A sessão continua rodando; Reconectar volta para ela.
  - Comandos que vêm da central do Claude ou de Ferramentas chegam digitados, sem Enter, para você revisar antes.
erros:
  - Acumular sessões esquecidas. Veja e encerre em Claude Code › Sessões.
  - Esperar que comandos digitados por você passem por aprovação. Só as ações dos agentes pedem aprovação; o terminal é seu.
relacionados: [claude-code, projetos, infra]
---
# Terminal

## O que é
O terminal roda dentro do container do console. A aba **Claude** abre o Claude Code interativo no projeto escolhido (ou no workspace); a aba **Shell** abre um bash. As sessões ficam guardadas no servidor (tmux).

## Passo a passo
1. **Abra.** Pelo menu (Ferramentas › Terminal), por Ctrl/⌘ `, ou por **Claude no projeto**/**Terminal** em Projetos.
2. **Escolha a aba.** "Claude · <projeto>" ou "Shell".
3. **Trabalhe.** Converse com o Claude ou rode comandos como num terminal normal.
4. **Recupere ou recomece.** **Reconectar** volta para a sessão; **Nova sessão** abre outra limpa.

## O que você vê na tela
- Abas Claude e Shell, com o nome do projeto.
- Botões Reconectar e Nova sessão no topo.

## Exemplos do dia a dia
- Pareando com o Claude num ajuste delicado → Claude no projeto e converse direto.
- Conferir um arquivo rápido → aba Shell.
- Login do Claude ou do GitHub → Configurações › Conexões abre este mesmo terminal com o comando certo.
