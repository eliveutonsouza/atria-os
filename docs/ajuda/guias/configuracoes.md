---
titulo: Configurações
grupo: Sistema
pagina: settings
ordem: 2
resumo: Contas conectadas, voz da Yui, modelos, aprovações, notificações, saúde do sistema e o acesso do suporte, tudo num lugar.
usar_quando: Na instalação, para reconectar uma conta, trocar a voz, ajustar quantos agentes rodam juntos ou ativar avisos no celular.
nao_usar_quando: Para mudar como um agente trabalha, use Agentes › Configuração.
frases:
  - "Yui, como conecto a minha conta Claude?"
  - "Como troco a voz da Yui?"
  - "Como ativo as notificações no celular?"
dicas:
  - Primeiros passos mostra o que falta conectar e leva direto a cada item com Configurar.
  - Mais agentes ao mesmo tempo deixa tudo mais rápido, mas consome mais do seu plano Claude (1 a 8; padrão 2).
  - Mudanças de voz valem na próxima conversa por voz.
  - Em Sistema, "Verificar de novo" confere cada peça; "Atualizar capacidades do Claude" relê conectores e skills.
  - Em Modelos, os modelos vêm da sua conta OpenAI e do Claude Code logado; se o seu não aparece, escolha **Outro…**, digite o nome exato e use **Testar**.
  - Um aparelho antigo ou perdido sai da lista em Notificações › Dispositivos inscritos › **Remover**.
erros:
  - Colar uma chave do plano ChatGPT. A chave precisa ser de API, da platform.openai.com.
  - Trocar a senha e estranhar o logout em outro aparelho. Trocar a senha encerra as outras sessões (inclusive a do suporte).
  - Colar preços em JSON com vírgula sobrando ou número entre aspas. O campo avisa e não deixa salvar.
  - Escrever preço por 1 mil tokens. Os preços são em US$ por 1 milhão de tokens (perMinute é US$ por minuto de voz).
relacionados: [conectores, celular, aprovacoes, agentes, suporte-e-atualizacoes]
---
# Configurações

## O que é
Tem as seções Primeiros passos, Conta, Conexões, Yui & voz, Modelos, Agentes & aprovações, Notificações, Sistema e Suporte e atualizações. O que você salva aqui vale mais que o arquivo .env da instalação.

## Passo a passo
1. **Primeiros passos.** Veja o que já está pronto e clique em **Configurar** no que falta.
2. **Conta.** Nome e e-mail (Você) e **Trocar senha** (mínimo de 8 caracteres).
3. **Conexões.** **Conectar conta Claude** abre um terminal: digite /login, autorize no link, cole o código e digite /exit. **Conectar GitHub** segue o mesmo jeito com um código de 8 letras. Cole a **Chave da OpenAI**, use **Testar chave** e **Salvar chave**. Conectores pendentes têm **Autorizar no claude.ai**.
4. **Yui & voz.** Voz, Encerrar voz após (min parada), Tecla de falar (Espaço, Crase, F8 ou Alt direito) e densidade das partículas do orb.
5. **Modelos.** Escolha em listas: **Voz em tempo real**, **Cérebro da Yui**, **Planejador**, **Embeddings** (lidos da sua conta OpenAI) e **Claude Code (agentes)** (lido do Claude Code logado; a primeira opção, "Padrão da conta", deixa a conta decidir). O modelo salvo aparece sempre, mesmo fora da lista. **Outro…** abre um campo para digitar o nome exato, com **Testar** para conferir se a conta tem acesso. **Atualizar lista** relê os modelos na hora; **Restaurar padrões** volta os cinco para o padrão do Atria OS. Em **Preços da OpenAI** cole um JSON como `{"gpt-6-luna":{"in":1.25,"out":10}}` — valores em US$ por 1 milhão de tokens (in, out, cachedIn, audioIn, audioOut) ou `perMinute` para voz cobrada por minuto; o nome vale como prefixo. Serve para o Consumo calcular custo de modelos novos. Agentes ao mesmo tempo também fica aqui.
6. **Agentes & aprovações.** Lista do que sempre pede aprovação e a opção "Pedir aprovação para ações sensíveis em conectores".
7. **Notificações.** Instalar app, Ativar notificações, Enviar teste e Dispositivos inscritos. Cada aparelho da lista tem **Remover** (pede confirmação); ele para de receber avisos até você ativar de novo nele.
8. **Sistema.** Saúde de cada peça, os comandos de atualizar e de backup na VPS e o **Monitoramento remoto** (opcional, ver o guia Monitoramento remoto).
9. **Suporte e atualizações.** Se a equipe Atria pode entrar para ajudar (com Acessos recentes e **Encerrar acesso**), se aceita atualizações mandadas por ela, a versão instalada e o estado do atualizador (ver o guia Suporte e atualizações).

## O que você vê na tela
- Selo de estado em cada conexão (conectado ou o que falta).
- Mensagem de confirmação ao salvar.
- Em Modelos: "Lista lida da sua conta OpenAI há X" ou, em vermelho, o erro ao ler a lista (ex.: chave não configurada).
- Em Sistema: ./install.sh --update e ./install.sh --backup, para rodar na pasta do Atria OS na VPS.

## Exemplos do dia a dia
- Agentes pararam de rodar → Sistema mostra o estado do Claude; reconecte em Conexões.
- Sem voz → Conexões › Testar chave da OpenAI.
- Fila grande todo dia → Modelos › Agentes ao mesmo tempo de 2 para 3.
- Saiu um modelo novo da OpenAI → Modelos › Atualizar lista, escolha no Cérebro e, se o Consumo mostrar custo sem preço, adicione em Preços da OpenAI.
- Trocou de celular → Notificações › Remover o aparelho antigo.
