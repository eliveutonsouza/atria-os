---
titulo: Navegador ao vivo
grupo: Ferramentas
pagina: browser
ordem: 1
resumo: Assista em tempo real o navegador que os agentes usam para testar sites, pesquisar e preencher páginas, e assuma o controle quando precisar.
usar_quando: Quando um agente está testando um site ou navegando e você quer ver o que ele vê, ou precisa fazer um login nesse navegador.
nao_usar_quando: Para ver o site de um projeto seu, use o Preview em Projetos.
frases:
  - "Yui, testa o formulário de contato do site da clínica."
  - "Como assumo o controle do navegador?"
  - "Entra no site X e confere se o botão de comprar funciona."
dicas:
  - Assistir não interfere. Só com Assumir controle ligado o mouse, o teclado e a barra de endereço funcionam.
  - Desligue Assumir controle quando terminar, para não atrapalhar o próximo agente.
  - O painel AÇÕES DO AGENTE mostra cada clique e navegação enquanto ele trabalha.
erros:
  - Mexer no navegador enquanto um agente está no meio de um teste. Espere ele terminar ou cancele a execução.
relacionados: [execucoes, projetos, conectores]
---
# Navegador ao vivo

## O que é
O Atria OS tem um Chromium próprio que os agentes usam pelo Playwright. Esta tela transmite esse navegador ao vivo, com as abas abertas, a execução que está usando e a lista de ações do agente.

## Passo a passo
1. **Peça um teste.** Fale com a Yui; o agente abre o site no navegador.
2. **Assista.** O selo do topo mostra quem está usando ("… está usando") ou "Ocioso".
3. **Acompanhe as ações.** EXECUÇÃO mostra a tarefa; AÇÕES DO AGENTE lista o que ele fez.
4. **Assuma se precisar.** Ligue **Assumir controle** para clicar, digitar, usar Voltar, Avançar, Recarregar ou digitar um endereço e clicar em **Abrir**.
5. **Devolva.** Desligue **Assumir controle**.

## O que você vê na tela
- Abas do navegador com título.
- Tela ao vivo com fps.
- "Navegador desconectado" se o serviço atria-browser não estiver respondendo.

## Exemplos do dia a dia
- QA testando um checkout → assista e veja onde ele travou.
- Site pede login que o agente não tem → assuma o controle, faça o login e devolva.
- Pesquisa de concorrentes → veja quais páginas o Research visitou.
