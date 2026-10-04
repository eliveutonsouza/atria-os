---
titulo: Vault
grupo: Conhecimento
pagina: vault
ordem: 2
resumo: A memória de longo prazo do console em notas no formato Obsidian, onde ficam decisões, lições, relatórios de execução e o diário.
usar_quando: Para guardar e achar decisões, ideias, lições e o que foi feito em cada dia ou projeto.
nao_usar_quando: Para contratos, tabelas e documentos oficiais que os agentes devem citar, use Empresa › Documentos.
frases:
  - "Yui, anota que o cliente da clínica prefere reunião às terças."
  - "O que a gente decidiu sobre o login do Stoqmate?"
  - "Abre a nota do dia."
  - "Você lembra por que trocamos de banco no projeto X?"
dicas:
  - Ligue notas com [[nome da nota]]. Cada link vira uma conexão no Cérebro.
  - O painel Conexões sugere ligações em "Yui sugere ligar"; clique em ligar para aceitar.
  - O histórico fica em git dentro do vault. As mudanças viram versão sozinhas em cerca de 2 minutos; "Salvar versão" grava na hora.
  - No celular não há VS Code: use a lista, leia e toque em Editar para mudanças simples.
erros:
  - Apagar ou reescrever notas que os agentes criaram (relatórios, lições). Acrescente em vez de substituir.
relacionados: [cerebro, empresa, execucoes]
---
# Vault

## O que é
Um vault de notas markdown em /workspace/.yui/vault, com pastas como 00-Inbox, 02-Decisoes, 03-Agentes, 04-Execucoes, 05-Projetos, 06-Ideias e Diario. O console escreve sozinho: cada execução que mexe em arquivos ou falha gera um relatório em 04-Execucoes, o dia ganha uma nota em Diario com a lista de execuções e um fechamento às 23h50, e cada projeto tem a sua nota. Os agentes registram lições em 03-Agentes e decisões (ADRs) em 02-Decisoes.

## Passo a passo
1. **Ache a nota.** Use "Buscar notas…" na árvore de Arquivos.
2. **Escolha o modo.** **Editor** (VS Code dentro do console), **Lado a lado** (editor e leitura) ou **Leitura**. **Abrir em aba ↗** abre o VS Code em tela cheia.
3. **Crie.** **+ Nova nota**: escolha a pasta, dê um título e clique em **Criar**. Ou peça à Yui "anota isso" (vai para 00-Inbox).
4. **Navegue pelas ligações.** O painel Conexões mostra Backlinks (quem cita esta nota), Links (quem ela cita) e sugestões da Yui. **Constelação →** abre a nota no Cérebro.
5. **Salve a versão.** Quando o rodapé mostrar alterações a salvar, **Salvar versão** grava no histórico.

## O que você vê na tela
- Árvore de arquivos com busca e botão Nova nota.
- Caminho da nota e o status do VS Code (VS Code ou "VS Code iniciando").
- Rodapé: "git · tudo salvo no histórico" ou o número de alterações pendentes; total de notas e links.
- Tags da nota como #tag.

## Exemplos do dia a dia
- Ideia no meio do dia → "Yui, guarda essa ideia: oferecer manutenção mensal para sites."
- Quer saber o que rolou num projeto → abra a nota do projeto em 05-Projetos e siga os links das execuções.
- Revisar o dia → abra Diario/<data de hoje>.
