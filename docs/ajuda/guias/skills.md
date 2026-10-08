---
titulo: Skills
grupo: Ferramentas
pagina: skills
ordem: 3
resumo: Loja de skills do skills.sh dentro do Atria OS. Veja as mais populares, leia o que cada uma ensina e instale com 1 clique na plataforma toda ou só nos agentes que precisam.
usar_quando: Quando quiser que o Claude saiba fazer algo melhor (TDD, design de interface, SEO, documentos, automação de navegador…) sem escrever instruções você mesmo.
nao_usar_quando: Para dar acesso a um serviço externo (Gmail, Drive, Vercel), use Conectores & MCP. Para mudar o prompt do agente, use a ficha do agente.
frases:
  - "Yui, instala a skill de TDD no agente QA."
  - "Yui, procura uma skill de SEO."
  - "Abre a loja de skills."
dicas:
  - "Plataforma toda" vale para a Yui, todos os agentes e o terminal. "Só estes agentes" fica invisível para os outros.
  - Na ficha do agente, a seção "Skills do skills.sh" já abre a instalação com aquele agente marcado.
  - Os selos de auditoria (Gen Agent Trust Hub, Socket, Snyk) vêm do skills.sh e são só informativos. Leia o SKILL.md antes de instalar algo com alerta.
  - "Verificar atualizações" compara com o GitHub do autor; "Atualizar" baixa a versão nova sem mudar onde ela está instalada.
  - Também dá para colar o link do skills.sh ou o comando "npx skills add … --skill …" em "Instalar por link".
erros:
  - Instalar tudo na plataforma. Skill demais confunde o Claude; prefira instalar só nos agentes que usam.
  - Skills que não ficam no GitHub (ex.: sites próprios) ainda não instalam automaticamente.
relacionados: [agentes, conectores, claude-code]
---
# Skills

## O que é
Skills são pacotes de conhecimento (um SKILL.md com instruções, às vezes com exemplos e scripts) que o Claude carrega quando a tarefa pede. O skills.sh é o diretório público mais usado. Aqui você navega por ele e instala sem terminal.

## Passo a passo
1. **Abra Skills.** Ferramentas › Skills, ou peça à Yui.
2. **Escolha.** Veja Populares, Em alta 24h ou Hot, ou busque por assunto (em inglês acha mais).
3. **Leia a ficha.** Clique no nome: descrição, auditorias de segurança e o SKILL.md que o Claude vai aprender.
4. **Escolha onde.** "Plataforma toda" ou "Só estes agentes" marcando os agentes.
5. **Instale.** O Atria OS baixa do GitHub do autor; vale na próxima execução.
   > Diga: "Yui, instala a skill grill-me no agente Research." Ela pede sua aprovação antes.

## O que você vê na tela
- Números: skills na plataforma, só em agentes, com atualização e o total do skills.sh.
- Cada card: posição, nome, repositório, selo "oficial", curva de instalações das últimas 8 semanas e onde já está instalada.
- Aba Instaladas: tudo que você instalou; clique para mudar o alcance, atualizar ou remover.

## Exemplos do dia a dia
- Agente QA escrevendo testes fracos → instale "tdd" só no QA.
- Sites saindo genéricos → "frontend-design" no Frontend e no Designer.
- Quer que todos saibam achar skills novas → "find-skills" na plataforma.
