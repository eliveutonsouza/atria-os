---
titulo: Claude Code
grupo: Ferramentas
pagina: claude
ordem: 3
resumo: Uma central de botões para os comandos e skills do Claude Code (revisar código, gerar testes, pesquisar, criar apresentação) sem decorar nada.
usar_quando: Quando você sabe o tipo de trabalho (revisão, testes, documentação, pesquisa) e quer disparar com um clique num projeto.
nao_usar_quando: Para pedidos em linguagem livre, fale com a Yui; ela escolhe o agente.
frases:
  - "Yui, abre a central do Claude Code."
  - "Faz uma revisão de segurança no Stoqmate."
  - "Gera testes para as partes críticas do projeto da clínica."
dicas:
  - Escolha o projeto antes de clicar; sem projeto, roda no workspace.
  - "Agente em segundo plano" devolve o resultado para a Yui e para Execuções; "Terminal interativo" abre o Claude com o comando digitado.
  - Use o campo de detalhes para focar ("só a pasta src/auth", URL do site, tema do relatório).
erros:
  - Botão apagado com "Não instalado nesta conta". A skill não existe na sua conta Claude; instale ou use outro botão.
relacionados: [terminal, agentes, conectores, projetos]
---
# Claude Code

## O que é
A central transforma ferramentas do Claude Code em botões, agrupados em Revisar código, Entender & documentar, Construir & testar, Design & documentos, Automatizar e Pesquisar. Cada botão roda de verdade: como agente em segundo plano ou no terminal interativo.

## Passo a passo
1. **Escolha o projeto** no seletor (ou "workspace (sem projeto)").
2. **Escolha como executar.** **Agente em segundo plano** ou **Terminal interativo**.
3. **Detalhe se quiser.** Escreva no campo "Detalhes opcionais".
4. **Clique no botão.** Ex.: Revisar PR, Segurança, Gerar CLAUDE.md, Explicar arquitetura, Gerar testes, Apresentação, PDF, Pesquisa, Leads.
5. **Acompanhe.** No modo segundo plano, **Acompanhar** abre a execução.

## O que você vê na tela
- Abas Comandos, Guia (mapa do Claude Code), Skills (com busca, Usar e Terminal) e Sessões (Reconectar e Encerrar sessões de terminal).
- Aviso quando as capacidades da conta ainda não foram lidas; nesse caso os botões ficam todos liberados.

## Exemplos do dia a dia
- Antes de entregar ao cliente → Segurança e Revisão profunda no projeto.
- Projeto herdado → Explicar arquitetura e Gerar CLAUDE.md.
- Reunião amanhã → Apresentação com o tema no campo de detalhes.
