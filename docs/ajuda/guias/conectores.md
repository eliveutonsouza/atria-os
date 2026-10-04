---
titulo: Conectores & MCP
grupo: Ferramentas
pagina: tools
ordem: 4
resumo: O que a Yui e os agentes conseguem usar (Gmail, Agenda, Drive, Linear, Vercel e outros), com status e o botão para autorizar o que falta.
usar_quando: Quando um agente diz que não tem acesso a um serviço, para conferir o que está conectado ou testar um conector.
nao_usar_quando: Para dar ou tirar um conector de um agente específico, use a Configuração do agente em Agentes.
frases:
  - "Yui, testa o conector do Google Calendar."
  - "Quais conectores estão com problema?"
  - "Abre as ferramentas."
dicas:
  - Os conectores vêm da sua conta Claude. "Autorizar" abre claude.ai/settings/connectors para você liberar.
  - Depois de autorizar ou instalar algo, clique em "Atualizar capacidades" para o console ler de novo.
  - "Testar" faz uma execução curta só de leitura; "Pedir à Yui" manda ela testar com uma consulta rápida.
erros:
  - Achar que conectar aqui libera ações sem controle. Envio, publicação, pagamento e exclusão continuam pedindo aprovação, a menos que você desligue em Configurações.
relacionados: [agentes, aprovacoes, claude-code, configuracoes]
---
# Conectores & MCP

## O que é
O painel mostra tudo que os agentes podem usar, em abas: Conectores, MCP, Skills, Plugins e Apps & stacks. No topo, os números de Ferramentas, Com problema, MCP conectados e Skills.

## Passo a passo
1. **Veja o estado.** Na aba Conectores ou MCP, cada item mostra se está ativo, com problema ou pedindo autorização.
2. **Autorize o que falta.** Clique em **Autorizar**, libere na página do claude.ai e volte.
3. **Releia.** **Atualizar capacidades** faz o console ler de novo conectores, skills e plugins.
4. **Teste.** **Testar** ou **Pedir à Yui** num item; os exemplos em chips também mandam um pedido pronto para a Yui.
5. **Explore skills.** A aba Skills agrupa por origem; clicar abre no terminal do Claude.

## O que você vê na tela
- Para que serve cada ferramenta e qual agente costuma usá-la (→ agente).
- Origem do MCP (claude.ai ou local).
- Plugins ativos; se não houver, instale pelo terminal com /plugin.
- **Mapa do Claude Code** no topo leva à central de comandos.

## Exemplos do dia a dia
- "Não tenho acesso ao Gmail" numa execução → aqui, Autorizar, Atualizar capacidades e peça de novo.
- Novo conector instalado no claude.ai → Atualizar capacidades para os agentes enxergarem.
- Dúvida se a agenda funciona → Pedir à Yui no Google Calendar.
