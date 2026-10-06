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
  - "Demite o agente Security; o Backend assume."
dicas:
  - O campo Especialidade é o que a Yui lê para decidir a quem delegar. Escreva claro o que o agente faz.
  - Use Testar depois de mexer: o agente se apresenta e lista as ferramentas que enxerga, sem alterar nada.
  - Restringir Conectores MCP deixa o agente mais focado; "Liberar todos" volta a dar acesso a tudo.
  - Arquivar tira o agente de circulação sem apagar; Reativar traz de volta. Demitir exclui de vez.
  - Modelo em "Padrão do console" segue o que estiver em Configurações › Modelos; escolha um modelo só se esse agente precisar de outro.
erros:
  - Editar e sair sem clicar em Salvar. O botão do topo mostra "Salvar" enquanto há mudanças.
  - Criar um agente com especialidade parecida com outro. A Yui fica em dúvida; prefira ajustar o existente.
  - Demitir quando só queria pausar. Para pausar, use Arquivar: demitir apaga o arquivo e não dá para desfazer pelo painel.
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
5. **Modelo.** Deixe em **Padrão do console — …** para seguir o modelo escolhido em Configurações › Modelos (o nome técnico aparece logo abaixo). Escolha outro da lista, ou **Outro…** para digitar um nome exato, só quando esse agente precisar.
6. **Crie ou duplique.** **+ Novo agente** cria um em branco e abre a Configuração; **Duplicar** copia um existente como ponto de partida.
7. **Execuções.** A terceira aba lista o que o agente rodou; clique para abrir o detalhe.
8. **Arquive ou demita.** **Arquivar** pausa o agente sem apagar: ele some da lista e para de receber tarefas, e volta com **Reativar** (filtro **Arquivados**). **Demitir** exclui de vez: o painel mostra onde ele está escalado (rotinas, passos de workflow, etapas de missões em aberto, ferramentas) e pede **Quem assume esses lugares**; ao confirmar, tudo passa para o substituto, o arquivo é apagado (fica uma cópia no histórico de agentes) e ele não volta quando o console reinicia.

## O que você vê na tela
- Acesso deste agente: quais MCP, skills e plugins ele usa ("todos os conectores" quando não há restrição).
- Execuções nas últimas 24h, na aba Configuração.
- Aviso "Agente arquivado" quando ele não recebe tarefas.
- Filtro **Ativos | Arquivados** acima da lista; nos arquivados, **Reativar** e **Demitir**.
- Modal **Demitir o agente …?** com os lugares onde ele é usado e o seletor de quem assume.

## Arquivar x demitir
| | Arquivar | Demitir |
|---|---|---|
| Arquivo do agente | fica | apagado (cópia no histórico) |
| Rotinas, workflows, missões | continuam apontando para ele | passam para o substituto |
| Volta depois? | sim, com Reativar | não (nem o agente padrão volta ao reiniciar) |

Pela Yui: "Demite o agente X" abre um modal de aprovação vermelho; nada é apagado antes do seu OK.

## Exemplos do dia a dia
- O Copy está escrevendo formal demais → ajuste as Instruções e Testar.
- Precisa de um especialista em tráfego pago → "Yui, cria um agente de tráfego pago que analisa campanhas e sugere ajustes."
- O Research falhou três vezes hoje → aba Execuções, abra a última e veja o erro.
- Não usa mais o Security e quer limpar a equipe → Demitir, escolha quem assume as rotinas dele e confirme.
