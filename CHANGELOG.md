# Changelog

Versões marcadas do Atria OS. Cada tag `vX.Y.Z` publica as imagens no GHCR e pode ser aplicada pelo Atria Central (Atualizações).

## v1.6.2
- Limite do Claude: aviso de limite sem porcentagem (que chega durante as execuções) não apaga mais o valor lido; o orçamento voltava a ficar cego no meio da janela.
- Entregas: arquivo apagado do disco sai do índice antes de contar o limite (a página podia aparecer vazia).

## v1.6.1
Correções achadas no teste de ponta a ponta numa instalação de teste:
- "Rodar agora" de uma rotina não fica mais preso esperando o limite do Claude (é pedido seu).
- Ficar com a refeita: quando a execução original deixou mudanças não salvas nos mesmos arquivos, o Atria lista os arquivos e pergunta antes de substituir (antes, falhava).
- Artefatos virou página do painel (menu Acompanhar), como no canvas aprovado.
- Botão de pendências no celular com 44 px e nome acessível.

## v1.6.0
- Entregas com pré-visualização: lista com filtros (documentos, imagens, planilhas, fixados, projeto, busca) e o arquivo aberto ao lado (PDF, imagem, CSV, Markdown, texto); no celular, tela cheia com as ações embaixo.
- Refazer com outro modelo e comparar: a refeita roda numa cópia isolada do projeto (sem push, deploy ou envios); original e refeita lado a lado, com "Ficar com a refeita" (aplica no projeto) ou "Descartar cópia"; também por voz.
- Telegram: a Yui pode responder também em áudio (Configurações › Avisos).

## v1.5.1
- "+" do campo da Yui abre atalhos (tarefa para agente, workflow, rotina, lembrete, missão, busca) que pré-preenchem o pedido.
- Selo de mensagens novas por projeto guardado no servidor: sobrevive a recarregar a página e a trocar de aparelho.
- Voz: aviso de outro projeto falado pelo GPT-Live não entra mais no histórico do projeto ativo.

## v1.5.0
Quarta fase das ideias do Paperclip/Hermes (aprendizado):
- Memória da Yui: "lembra que…", "o que você sabe de mim?", "esquece que…"; só grava o que você pediu com as suas palavras; vale para voz, painel e Telegram; Configurações › Conta › Memória da Yui.
- Lições por agente: revisão automática de execuções longas, com falha, rejeição ou 👎 (até 30 por dia, modelo barato); até 15 lições por agente, desfazer na ficha; fusão semanal; lições antigas do vault importadas.
- Skills propostas pelo agente, pela revisão ou por voz ("salva isso como skill"), com lint de segurança; viram skill local só do agente que propôs.
- Cartão diário "Yui aprendeu": você marca o que guardar (memória e skills, com texto e mudanças); Depois esconde até amanhã.

## v1.4.0
Terceira fase das ideias do Paperclip/Hermes (entregas e qualidade):
- Entregas dos agentes: registro automático do que a execução gerou (pasta do workflow, relatórios, screenshots) e ferramenta para o agente registrar o resto; lista em Artefatos com abrir, baixar, mandar no Telegram e fixar; limpeza após 30 dias; "me manda o PDF que o agente fez" por voz.
- Nota 👍/👎 por execução (botões e voz), nas métricas por agente do balanço.
- Missões conferem o fim sem IA: "concluída com ressalvas" quando há etapa sem resultado, falha no texto, limite de turnos ou arquivo prometido sem entrega.

## v1.3.0
Segunda fase das ideias do Paperclip/Hermes (canal e lembrança):
- Conversar com a Yui pelo Telegram: texto e áudio do chat vinculado, projeto próprio (/projeto), aprovações comuns com botões; exclusões só no painel.
- Busca no histórico (FTS5): conversa e resultados das execuções, no painel Conversa e por voz ("o que eu te pedi sobre X?").
- Balanço falado: "como foi minha semana?" (execuções, falhas, custo, uso do plano).
- Rotinas: entrega do resultado por Telegram/e-mail/push (sempre, só se mudou ou só se falhar), não empilham disparos e recuperam o último disparo perdido.

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
