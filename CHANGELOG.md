# Changelog

Versões marcadas do Atria OS. Cada tag `vX.Y.Z` publica as imagens no GHCR e pode ser aplicada pelo Atria Central (Atualizações).

## v1.2.0
Primeira fase das ideias trazidas do Paperclip e do Hermes (proteção, sem custo de tokens):
- Orçamento pelo % do plano Claude: acima do limite (padrão 95%), rotinas e workflows disparados por rotina esperam a janela reiniciar; o que você pede na hora sempre roda. Aviso em 80%, teto diário opcional da OpenAI e teto opcional por execução automática.
- Watchdog: execução sem atividade por 20 min gera aviso; no dobro, para e libera a vaga.
- Aprovações com "Lembrar esta decisão": sempre permitir/bloquear uma ação exata, por agente e projeto, revogável (Configurações e por voz).
- Objetivo do projeto: entra no prompt de todos os agentes do projeto; editável no painel e por voz.
- Versões anteriores do agente: ver e restaurar (também por voz).

## v1.1.1
- Cada execução de workflow tem pasta própria (`<projeto>/.atria/execucoes/<workflow>/<data>-<id>`), compartilhada pelos passos dela: dá para rodar o mesmo workflow várias vezes ao mesmo tempo sem uma sobrescrever os arquivos da outra. A pasta aparece no histórico de execuções do workflow e fica fora do git do projeto.

## v1.1.0
- Multi-projeto na tela principal: seletor de projeto clicável (Ctrl P), com execuções rodando e mensagens novas por projeto; cada projeto tem a própria conversa com a Yui ("Geral" = sem projeto).
- Painel Execuções (contador no topo ou "Agentes trabalhando"): tarefas rodando, na fila e aguardando aprovação agrupadas por projeto, com Ver, Parar, Revisar e Ir para o projeto.
- Até 4 execuções ao mesmo tempo (antes 2); quem espera aprovação não ocupa vaga; a fila alterna entre projetos.
- Tarefas pedidas sem citar projeto vão para o projeto ativo; aviso de tarefa concluída em outro projeto diz "No projeto X".
- Tocar no orb liga/desliga a voz; Claude/OpenAI no topo abre Contas e modelos.

## v1.0.1
- Changelog do produto (`CHANGELOG.md`).
- Primeira atualização feita pelo Atria Central na instância pessoal (teste do atualizador).

## v1.0.0
- Primeira versão marcada: imagens prontas no GHCR (atria-os, atria-code, atria-updater) e atualização pelo Atria Central, com volta automática se a instância não ficar saudável.
- Suporte remoto, avisos do Central e instalação em 1 comando.
- Workflows com "Pedir informação" (para e espera: texto, data, áudio transcrito, imagens, arquivos) e "Avisar" (Telegram, e-mail, push).
- Loja de skills do skills.sh por agente ou para a plataforma.
