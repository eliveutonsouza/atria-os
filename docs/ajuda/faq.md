# Perguntas frequentes

## Conversa
### Preciso falar ou posso digitar?
Os dois. Digite no campo da Yui e tecle Enter, ou segure Espaço para falar. Três toques rápidos no Espaço ligam a conversa contínua; um toque volta ao modo segurar-para-falar.

### A Yui faz o trabalho ou passa para alguém?
Ela conversa, consulta os dados e decide. O trabalho de verdade (código, pesquisa, textos, e-mails) é feito pelos agentes Claude Code, que ela acorda com uma instrução completa.

### Por que o agente fez diferente do que eu falei?
O agente não ouve a conversa; ele recebe só a instrução que a Yui monta. Diga o pedido completo numa frase (o quê, para quem, em qual projeto, como entregar) e confira a tarefa em Execuções.

### Como volto da Yui para o dashboard e vice-versa?
Ctrl/⌘ J alterna entre os dois. Também dá para passar o mouse na borda esquerda para abrir o dashboard e clicar no orb do canto para voltar à conversa.

## Segurança
### Os agentes podem fazer deploy ou apagar algo sem eu saber?
Sim, por padrão: workflows, rotinas, missões e projetos rodam no automático, com push, deploy, docker e envios, e tudo fica registrado em Execuções. Eles só param onde você pediu aprovação ("me pede OK antes de publicar", "Sempre me perguntar" no passo do workflow ou yui.json › approvalPatterns). O catastrófico é sempre bloqueado: apagar raiz/workspace/dados inteiros, formatar disco, DROP DATABASE, prune do Docker, stacks de produção protegidos e force push na main. Para voltar a aprovar ações de conectores (enviar, publicar, pagar), ligue em Configurações › Agentes & aprovações.

### A Yui pode aprovar por mim?
Não. Ela só mostra o pedido. Quem clica em Aprovar ou Rejeitar é você.

### O que acontece se eu rejeitar?
O agente é avisado, continua sem aquela ação e explica no resultado. Numa missão, a etapa rejeitada é pulada junto com as que dependiam dela. Num workflow, a execução para.

### Dá para exigir aprovação em outros comandos de um projeto?
Sim. No arquivo yui.json na raiz do projeto, liste os padrões extras em approvalPatterns, por exemplo "npm run deploy".

## Celular
### Como recebo avisos no celular?
Instale o app (Configurações › Notificações › Instalar app) e toque em Ativar notificações. No iPhone, primeiro adicione à Tela de Início pelo Safari. Use Enviar teste para confirmar.

### Por que a notificação não chegou?
Os avisos só são enviados quando nenhuma tela do console está aberta e ativa. Se o painel está aberto no computador, o aviso aparece nele e não no celular.

### Uma aprovação vence se eu demorar?
Não. Ela espera até você decidir. Só some se a missão ou o workflow dono dela for cancelado.

## Rotina
### Qual a diferença entre missão, workflow e rotina?
Missão é um projeto único dividido em etapas pela Yui. Workflow é um processo que se repete, desenhado com tarefas, decisões e aprovações. Rotina é o agendamento: roda um workflow ou uma instrução simples de um agente em horário fixo.

### Em que fuso rodam os agendamentos?
No horário de São Paulo (America/Sao_Paulo).

### Como testo uma rotina sem esperar o horário?
Em Agendamentos, clique em Rodar agora na rotina. Num workflow, use Rodar agora no editor.

### Posso pausar tudo durante as férias?
Pause cada rotina em Agendamentos (botão Pausar). Ela fica guardada e volta com Ativar.

## Empresa
### O que entra no Perfil da empresa?
Nome, razão social, CNPJ, segmento, site, cidade, o que a empresa faz, para quem, tom de voz, serviços e preços. Esse texto entra no começo de toda conversa da Yui e de toda execução de agente.

### Que arquivos posso enviar para a base?
PDF, DOCX, PPTX, XLSX, TXT, MD e imagens escaneadas (JPG/PNG), até 50 MB cada. Eles passam por OCR, extração de dados e indexação antes de ficarem prontos.

### Excluir um documento apaga tudo?
Sim. Some o arquivo original, o texto extraído, os trechos de busca e a nota no vault, e a Yui e os agentes deixam de encontrar o conteúdo na hora. Não dá para desfazer.

## Vault
### Quem escreve no vault?
Você, a Yui (quando você pede "anota isso") e os agentes, que registram lições e decisões. O console também cria sozinho a nota do dia, a nota de cada projeto e relatórios das execuções que mudaram arquivos ou falharam.

### Perdi uma mudança numa nota. Dá para recuperar?
O vault guarda histórico em git. As mudanças viram versão sozinhas em cerca de 2 minutos; o botão Salvar versão grava na hora. Para voltar uma versão antiga, use o terminal na pasta /workspace/.yui/vault.

### Qual a diferença entre o Vault e a Empresa?
A Empresa guarda documentos oficiais (contratos, preços, marca) que os agentes citam com página. O Vault guarda memória de trabalho: decisões, ideias, lições, diário e relatórios.

## Custos
### O que é o custo que aparece nas execuções?
É o custo estimado de cada execução de agente, somado na Visão geral e nas estatísticas de cada agente. Os agentes usam a sua conta Claude Pro/Max; a voz, o cérebro da Yui, o planejador de missões e a leitura de documentos usam a sua chave da OpenAI.

### Como gasto menos com voz?
A voz é cobrada por segundo. Ela encerra sozinha depois de alguns minutos parada (padrão 5); ajuste em Configurações › Yui & voz › Encerrar voz após. Para pedidos rápidos, digite.

### Rodar mais agentes ao mesmo tempo custa mais?
Deixa tudo mais rápido, mas consome mais do seu plano Claude ao mesmo tempo. O padrão é 2; ajuste de 1 a 8 em Configurações › Modelos.

## Problemas
### Os agentes não rodam. O que faço?
Veja Configurações › Sistema; se o Claude aparecer desconectado, vá em Conexões › Conectar conta Claude e faça o /login de novo.

### A Yui não fala.
Confira a chave em Configurações › Conexões › Testar chave. A chave precisa ser de API da OpenAI; o plano ChatGPT não serve.

### O agente diz que não tem acesso ao Gmail (ou outro serviço).
Abra Conectores & MCP, clique em Autorizar no conector, libere no claude.ai e depois clique em Atualizar capacidades.

### Meus projetos não aparecem.
Conecte o GitHub em Configurações › Conexões › Conectar GitHub. O catálogo aparece em Projetos em até 5 minutos.
