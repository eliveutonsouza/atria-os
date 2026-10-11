---
titulo: Projetos
grupo: Organizar
pagina: projects
ordem: 4
resumo: Seus repositórios do GitHub num catálogo só, com saúde, atividade, configuração e atalhos para terminal, Claude, logs e preview. Dá para adicionar e remover projetos pelo painel.
usar_quando: Para abrir um projeto e agir nele: ver se está saudável, olhar logs, abrir o Claude ou o preview, pedir uma correção.
nao_usar_quando: Para saúde da VPS inteira (CPU, RAM, containers), use Infra & logs.
frases:
  - "Yui, abre o Stoqmate."
  - "Lista meus repositórios de site."
  - "Agora no projeto clinica-site."
  - "Como está o projeto da clínica?"
dicas:
  - Os projetos vêm do GitHub sozinhos; repositórios ainda não clonados são clonados quando você abre ou delega algo. Para clonar na hora ou trazer um repositório de fora do seu GitHub, use "+ Adicionar projeto".
  - "Todos do GitHub" mostra também os não clonados; "Só clonados" volta ao que está na VPS.
  - "Configuração do projeto" (no fim da tela do projeto) edita o atria.json: URL de saúde, container dos logs, pasta de preview e comandos que pedem aprovação.
  - "Remover do Atria OS" apaga só a pasta local na VPS. O repositório no GitHub não muda.
erros:
  - Lista vazia. Conecte o GitHub em Configurações › Conexões; o catálogo aparece em alguns minutos.
  - "Não consegui remover". Há execução ativa no projeto: cancele em Execuções e tente de novo.
  - Remover e o projeto voltar. Abrir o projeto ou delegar algo nele clona de novo; repositórios com push recente também são clonados quando o Atria OS reinicia.
  - "Não consegui clonar" pela URL. Só https, sem usuário/senha na URL; repositório privado fora do GitHub não funciona.
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
6. **Adicione um projeto.** **+ Adicionar projeto** abre o formulário: em **Do GitHub** escolha um repositório do catálogo ainda não clonado; em **URL git** cole um endereço https (e, se quiser, o nome da pasta). **Clonar e adicionar** clona em /workspace/<pasta> e abre o projeto.
7. **Configure.** Em **Configuração do projeto**, clique em **Editar** (ou **Configurar** no topo), preencha URL de saúde, container dos logs, pasta de preview e um comando por linha em "Comandos que pedem aprovação", e **Salvar configuração**.
8. **Remova.** **Remover do Atria OS** pede confirmação e apaga a pasta local do clone, inclusive alterações não enviadas. O GitHub não é afetado.

## O que você vê na tela
- Ponto colorido e porcentagem de saúde (ou "clonado"/"no GitHub" quando não há medição).
- Linguagem e quando foi o último push.
- Atividade recente: execuções e eventos do projeto.
- Configuração do projeto: o que está no atria.json, com Editar e Remover do Atria OS.

## Exemplos do dia a dia
- Cliente diz que o site caiu → abra o projeto, veja a saúde, clique em Logs.
- Quer mexer junto com o Claude → Claude no projeto.
- Mostrar o site para alguém → Preview.

## Objetivo do projeto
Em Configuração do projeto › Editar › **Objetivo do projeto**, escreva o porquê do projeto (até 600 caracteres). Todo agente que trabalha nele lê isso junto com a tarefa, e usa para decidir prioridades e detalhes.
- Por voz: "Yui, o objetivo do Stoqmate é chegar a 50 clientes até dezembro" ou "qual o objetivo deste projeto?".
