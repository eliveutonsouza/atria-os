---
titulo: Configurações
grupo: Sistema
pagina: settings
ordem: 2
resumo: Contas conectadas, voz da Yui, modelos, aprovações, notificações e saúde do sistema, tudo num lugar.
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
erros:
  - Colar uma chave do plano ChatGPT. A chave precisa ser de API, da platform.openai.com.
  - Trocar a senha e estranhar o logout em outro aparelho. Trocar a senha encerra as outras sessões.
relacionados: [conectores, celular, aprovacoes, agentes]
---
# Configurações

## O que é
Tem as seções Primeiros passos, Conta, Conexões, Yui & voz, Modelos, Agentes & aprovações, Notificações e Sistema. O que você salva aqui vale mais que o arquivo .env da instalação.

## Passo a passo
1. **Primeiros passos.** Veja o que já está pronto e clique em **Configurar** no que falta.
2. **Conta.** Nome e e-mail (Você) e **Trocar senha** (mínimo de 8 caracteres).
3. **Conexões.** **Conectar conta Claude** abre um terminal: digite /login, autorize no link, cole o código e digite /exit. **Conectar GitHub** segue o mesmo jeito com um código de 8 letras. Cole a **Chave da OpenAI**, use **Testar chave** e **Salvar chave**. Conectores pendentes têm **Autorizar no claude.ai**.
4. **Yui & voz.** Voz, Encerrar voz após (min parada), Tecla de falar (Espaço, Crase, F8 ou Alt direito) e densidade das partículas do orb.
5. **Modelos.** Voz, Cérebro, Planner de missões, modelo padrão dos agentes Claude e Agentes ao mesmo tempo.
6. **Agentes & aprovações.** Lista do que sempre pede aprovação e a opção "Pedir aprovação para ações sensíveis em conectores".
7. **Notificações.** Instalar app, Ativar notificações, Enviar teste e Dispositivos inscritos.
8. **Sistema.** Saúde de cada peça e os comandos de atualizar e de backup na VPS.

## O que você vê na tela
- Selo de estado em cada conexão (conectado ou o que falta).
- Mensagem de confirmação ao salvar.
- Em Sistema: ./install.sh --update e ./install.sh --backup, para rodar na pasta do Yui Console na VPS.

## Exemplos do dia a dia
- Agentes pararam de rodar → Sistema mostra o estado do Claude; reconecte em Conexões.
- Sem voz → Conexões › Testar chave da OpenAI.
- Fila grande todo dia → Modelos › Agentes ao mesmo tempo de 2 para 3.
