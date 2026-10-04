---
titulo: Projetos
grupo: Organizar
pagina: projects
ordem: 4
resumo: Seus repositórios do GitHub num catálogo só, com saúde, atividade e atalhos para terminal, Claude, logs e preview.
usar_quando: Para abrir um projeto e agir nele: ver se está saudável, olhar logs, abrir o Claude ou o preview, pedir uma correção.
nao_usar_quando: Para saúde da VPS inteira (CPU, RAM, containers), use Infra & logs.
frases:
  - "Yui, abre o Stoqmate."
  - "Lista meus repositórios de site."
  - "Agora no projeto clinica-site."
  - "Como está o projeto da clínica?"
dicas:
  - Você não cadastra projeto: eles vêm do GitHub sozinhos. Repositórios ainda não clonados são clonados quando você abre ou delega algo.
  - "Todos do GitHub" mostra também os não clonados; "Só clonados" volta ao que está na VPS.
  - Um arquivo yui.json na raiz do projeto define URL de saúde, container dos logs, pasta de preview e pedidos extras de aprovação.
erros:
  - Lista vazia. Conecte o GitHub em Configurações › Conexões; o catálogo aparece em alguns minutos.
relacionados: [infra, terminal, claude-code, missoes]
---
# Projetos

## O que é
Cada projeto é um repositório seu no GitHub, guardado em /workspace/<nome> quando clonado. A Yui e os agentes trabalham dentro dele. A tela mostra o catálogo e, ao escolher um, as ações e a atividade recente.

## Passo a passo
1. **Ache o projeto.** Use "Buscar entre … repositórios…" e o botão **Todos do GitHub** / **Só clonados**.
2. **Abra.** Clique no cartão. Aparecem saúde, status e atividade recente.
3. **Aja.** **Claude no projeto** abre o Claude Code interativo na pasta; **Terminal** abre um shell; **Logs** leva a Infra & logs; **Comandos do Claude** abre a central de comandos; **Preview** mostra o site.
4. **Peça correção.** Se o projeto tem um problema detectado, **Pedir correção** acorda o Backend com a descrição do erro.
5. **Troque o projeto ativo por voz.** "Agora no Stoqmate" faz os próximos pedidos irem para ele.

## O que você vê na tela
- Ponto colorido e porcentagem de saúde (ou "clonado"/"no GitHub" quando não há medição).
- Linguagem e quando foi o último push.
- Atividade recente: execuções e eventos do projeto.

## Exemplos do dia a dia
- Cliente diz que o site caiu → abra o projeto, veja a saúde, clique em Logs.
- Quer mexer junto com o Claude → Claude no projeto.
- Mostrar o site para alguém → Preview.
