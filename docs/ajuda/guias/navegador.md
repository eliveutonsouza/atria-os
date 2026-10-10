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
  - "Apareceu uma verificação de robô no navegador, como resolvo?"
dicas:
  - Assistir não interfere. Só com Assumir controle ligado o mouse, o teclado e a barra de endereço funcionam.
  - Desligue Assumir controle quando terminar, para não atrapalhar o próximo agente.
  - O painel AÇÕES DO AGENTE mostra cada clique e navegação enquanto ele trabalha.
  - Quando chegar o aviso "Verificação humana pendente", abra esta tela, clique em Resolver e faça o desafio. O agente continua sozinho.
  - Para extrair dados de sites protegidos, peça para usar o Firecrawl ou o Apify, que não dependem deste navegador.
erros:
  - Mexer no navegador enquanto um agente está no meio de um teste. Espere ele terminar ou cancele a execução.
  - Esperar que o agente resolva o CAPTCHA sozinho. Ele não tenta burlar a verificação; quem resolve é você.
relacionados: [execucoes, projetos, conectores]
---
# Navegador ao vivo

## O que é
O Atria OS tem um navegador próprio, que roda no servidor e que os agentes usam pelo Playwright. Esta tela transmite esse navegador ao vivo, com as abas abertas, a execução que está usando e a lista de ações do agente.

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
- Faixa amarela "Verificação humana pendente em <site>" quando um site pediu para provar que é humano.

## Exemplos do dia a dia
- QA testando um checkout → assista e veja onde ele travou.
- Site pede login que o agente não tem → assuma o controle, faça o login e devolva.
- Pesquisa de concorrentes → veja quais páginas o Research visitou.

## Verificação humana ("verifique que você é humano")
Alguns sites mostram uma tela de verificação antes de abrir: "Just a moment…", "Verifique se você é humano", a caixinha "Não sou um robô" ou um quebra-cabeça de imagens. Isso acontece porque:
- o navegador do Atria roda num servidor, com IP de datacenter, que os sistemas anti-robô (Cloudflare, reCAPTCHA, hCaptcha e outros) tratam com mais desconfiança;
- é um navegador sem o seu histórico, e cada site novo começa do zero.

O Atria não tenta burlar nem quebrar a verificação. Quando ela aparece:
1. O agente **pausa** e a execução fica como "Verificação humana pendente em <site>".
2. Você recebe um **aviso** por notificação e Telegram, e um item no Inbox, com link para esta tela.
3. Abra o **Navegador**, clique em **Resolver** (liga o Assumir controle) e faça o desafio na tela ao vivo, como faria no seu computador: marque a caixinha, escolha as imagens ou segure o botão.
4. Quando a página do site abrir, o agente **continua sozinho**. A liberação fica guardada no navegador e costuma valer por alguns dias para aquele site.

Se ninguém resolver em **30 minutos**, o agente desiste daquele site e segue com outra estratégia. Bloqueios do tipo "Access Denied" (Akamai) não têm desafio para resolver: o agente já segue sem esperar.

## Quando usar outro caminho
- **Extrair dados** (textos, listas, preços, contatos) de sites protegidos: peça para usar o **Firecrawl** ou o **Apify** (em Conectores). Eles foram feitos para isso e não dependem deste navegador.
- **Sites em que você já tem login** ou que bloqueiam servidores: use o **Chrome do seu computador** com a extensão Claude in Chrome conectada. O agente usa o seu navegador, com o seu IP e a sua sessão.
- **Navegador do Atria**: para testar sites, preencher formulários e tirar screenshots, principalmente dos seus próprios projetos.
