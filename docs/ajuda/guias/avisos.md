---
titulo: Avisos (Telegram, e-mail e push)
grupo: Sistema
pagina: settings
ordem: 6
resumo: Liga o Telegram, o e-mail e o push para os workflows te avisarem e pedirem informações, e define de quanto em quanto tempo um pedido parado é lembrado.
usar_quando: Quando um workflow usa os passos Avisar ou Pedir informação e você quer receber pelo Telegram, por e-mail ou no app do Atria OS, e responder de lá.
nao_usar_quando: Para escolher quais tipos de notificação o app mostra no aparelho, use Configurações › Notificações; para um lembrete pessoal com hora marcada, use Lembretes.
frases:
  - "Yui, como ligo o Telegram para receber os avisos dos workflows?"
  - "Como respondo um pedido do workflow pelo Telegram?"
  - "Configura o e-mail dos avisos."
  - "Muda o lembrete dos pedidos para a cada 12 horas."
dicas:
  - Só o chat que mandou o código de vínculo é aceito pelo bot. Para trocar de chat, use Desvincular e gere outro código.
  - Pelo Telegram, responda a própria mensagem do aviso. Assim o bot sabe de qual pedido se trata mesmo com vários abertos.
  - O bot do Telegram só baixa arquivos de até 20 MB. Gravação maior vai pelo formulário do Atria (até 500 MB).
  - Pedidos de informação chegam no celular mesmo com o app aberto em outra aba.
erros:
  - Colar o token e não mandar /start com o código para o bot. Sem isso, o Telegram fica como "falta ligar o chat".
  - Usar no Resend um remetente de domínio não verificado. O teste falha até o domínio ser verificado lá.
relacionados: [workflows, celular, configuracoes]
---
# Avisos (Telegram, e-mail e push)

## O que é
A seção **Avisos** em Configurações liga os canais que os workflows usam: o passo **Avisar** manda mensagens e o passo **Pedir informação** para o fluxo, te avisa com o link do formulário e espera a sua resposta. Cada passo escolhe por onde avisar; canal não configurado fica de fora sem travar nada.

## Passo a passo
1. **Abra.** Configurações › **Avisos**.
2. **Crie o bot do Telegram.** No Telegram, fale com **@BotFather**, mande `/newbot` e escolha um nome. Ele responde com um token.
3. **Cole o token.** Em Token do bot, cole e clique em **Salvar token**.
4. **Ligue o seu chat.** Aparece um código de vínculo. Clique em **Abrir o bot no Telegram** (ou mande `/start <código>` para o bot). A tela mostra **Chat ligado** com o seu nome; só esse chat passa a ser aceito.
5. **Teste.** **Mandar teste** envia uma mensagem para o chat ligado.
6. **E-mail (opcional).** Crie uma chave de API no resend.com, verifique o domínio do remetente e preencha Chave da Resend, Remetente e Para. Clique em **Salvar** e em **Mandar teste**.
7. **Push.** Usa o app Atria OS instalado e os aparelhos de Configurações › Notificações (**Gerenciar aparelhos**).
8. **Lembrete.** Em **Lembrete de pedido parado**, escolha de quantas em quantas horas um pedido sem resposta é lembrado (padrão 24 h).

## Responder pelo Telegram
- Responda a mensagem do aviso com a gravação (voz, áudio ou arquivo), fotos ou documentos.
- Texto também vale: "reunião hoje, fechou sim, valor 3 mil". A Yui entende e preenche os campos.
- A cada mensagem o bot diz o que já recebeu e o que falta. Com os obrigatórios completos, aparecem **Enviar e continuar** e **Ainda não**.
- Se houver mais de um pedido aberto e você não responder uma mensagem específica, o bot pergunta qual é.

## O que você vê na tela
- Telegram: estado (ligado, falta ligar o chat, não configurado), os três passos, token, código de vínculo, chat ligado, Desvincular e Mandar teste.
- E-mail: estado, Chave da Resend, Remetente, Para, Salvar e Mandar teste.
- Celular (push): quantos aparelhos recebem e o intervalo do lembrete.

## Exemplos do dia a dia
- Workflow de lead manda o site demo e o roteiro da ligação no Telegram e no e-mail.
- Depois da reunião, você responde o aviso do bot com a nota de voz e o fluxo segue com a transcrição.
