---
titulo: Agentes
grupo: Acompanhar
pagina: agents
ordem: 3
resumo: A sua equipe de agentes Claude Code, com números de desempenho e a ficha de cada um para ajustar instruções, conectores e skills.
usar_quando: Para ver como um agente está indo, ajustar como ele trabalha, testar se está funcionando ou criar um especialista novo.
nao_usar_quando: Para pedir um trabalho, fale com a Yui; ela escolhe o agente certo sem você abrir esta tela.
frases:
  - "Yui, quais agentes eu tenho?"
  - "Abre o agente Designer."
  - "Cria um agente de SEO que audita sites e sugere melhorias."
dicas:
  - O campo Especialidade é o que a Yui lê para decidir a quem delegar. Escreva claro o que o agente faz.
  - Use Testar depois de mexer: o agente se apresenta e lista as ferramentas que enxerga, sem alterar nada.
  - Restringir Conectores MCP deixa o agente mais focado; "Liberar todos" volta a dar acesso a tudo.
  - Arquivar tira o agente de circulação sem apagar; Reativar traz de volta.
erros:
  - Editar e sair sem clicar em Salvar. O botão do topo mostra "Salvar" enquanto há mudanças.
  - Criar um agente com especialidade parecida com outro. A Yui fica em dúvida; prefira ajustar o existente.
relacionados: [execucoes, operacoes, conectores, claude-code]
---
# Agentes

## O que é
Cada agente é um Claude Code com papel próprio: Backend, Frontend, QA, DevOps, Security, Research, Copy, Designer, Report e Assistente (agenda, e-mail, documentos via conectores). A tela lista a equipe à esquerda e, à direita, o agente escolhido em três abas.

## Passo a passo
1. **Escolha o agente** na lista. O ponto azul indica que está trabalhando; a porcentagem é o sucesso recente.
2. **Estatísticas.** Execuções em 30 dias, sucesso, duração média, custo, gráfico de 14 dias e ferramentas mais usadas.
3. **Configuração.** Edite Nome, Grupo, Modelo, Máx. de turnos, Especialidade, Instruções (prompt), Conectores MCP, Skills e Plugins preferidos. Clique em **Salvar**.
4. **Teste.** **Testar** roda uma execução curta de apresentação. **Abrir no terminal** abre o agente no Claude Code interativo.
5. **Crie ou duplique.** **+ Novo agente** cria um em branco e abre a Configuração; **Duplicar** copia um existente como ponto de partida.
6. **Execuções.** A terceira aba lista o que o agente rodou; clique para abrir o detalhe.

## O que você vê na tela
- Acesso deste agente: quais MCP, skills e plugins ele usa ("todos os conectores" quando não há restrição).
- Execuções nas últimas 24h, na aba Configuração.
- Aviso "Agente arquivado" quando ele não recebe tarefas.

## Exemplos do dia a dia
- O Copy está escrevendo formal demais → ajuste as Instruções e Testar.
- Precisa de um especialista em tráfego pago → "Yui, cria um agente de tráfego pago que analisa campanhas e sugere ajustes."
- O Research falhou três vezes hoje → aba Execuções, abra a última e veja o erro.
