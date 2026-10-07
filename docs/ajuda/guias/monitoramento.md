---
titulo: Monitoramento remoto
grupo: Sistema
pagina: settings
ordem: 4
resumo: Liga o pulso que manda a saúde deste Atria OS (máquina, containers, execuções, consumo de IA) para o Atria Central de quem administra várias instâncias.
usar_quando: Quando o administrador te passou um endereço de monitor e uma chave atk_ para acompanhar este Atria OS de fora.
nao_usar_quando: Para ver a saúde do seu próprio Atria OS, use Configurações › Sistema › Saúde ou a página Infra.
frases:
  - "Yui, como ligo o monitoramento remoto?"
  - "Onde coloco a chave do Atria Central?"
  - "O que o Atria OS manda para o monitor?"
dicas:
  - Testar conexão usa o endereço e a chave digitados, mesmo antes de salvar.
  - Chave em branco ao salvar mantém a chave guardada.
  - "O que é enviado" mostra o JSON exato de agora; nada de conversa, tarefa, resultado ou documento vai junto.
  - Com o monitor fora do ar o Atria OS tenta de novo sozinho (30 s, 1 min, 2 min… até 5 min) e guarda os eventos até conseguir.
erros:
  - Usar http:// no endereço. O monitor precisa de https://.
  - Compartilhar a URL de saúde sem a chave e estranhar o 401. Ela só responde com o cabeçalho Authorization da chave.
relacionados: [configuracoes, infra, consumo]
---
# Monitoramento remoto

## O que é
Um pulso a cada 30 s com métricas deste Atria OS para o painel do administrador (Atria Central): CPU, RAM, disco, containers e reinícios, execuções do dia e falhas, aprovações pendentes, limites e custo de IA, erros técnicos e eventos curtos ("Execução falhou · agente backend"). O monitor também consulta a URL de saúde deste Atria OS quando o pulso atrasa.

## Passo a passo
1. **Abra Configurações › Sistema.** A seção **Monitoramento remoto** fica abaixo de Saúde.
2. **Endereço do monitor.** Cole o endereço que o administrador passou (começa com https://).
3. **Chave da instância.** Cole a chave atk_… (ou ymk_… antiga) gerada no monitor ao cadastrar este Atria OS.
4. **Testar conexão.** Mostra "Conectado · 200" ou o motivo da falha (chave recusada, sem resposta…).
5. **Salvar** e ligue a chave **Monitoramento remoto**. O status passa a mostrar "último envio há X s".
6. **URL de saúde.** Use **Copiar** se o administrador pedir; ela é protegida pela mesma chave.

## O que você vê na tela
- Status: Desligado, aguardando o primeiro envio, último envio com o código (200 ok) ou a falha.
- URL de saúde deste Atria OS com **Copiar**.
- "O que é enviado": o JSON de agora, recolhível.

## Exemplos do dia a dia
- O administrador trocou a chave → cole a nova em Chave da instância, **Testar conexão** e **Salvar**.
- Status "último envio falhou (Chave recusada pelo monitor)" → confira a chave com o administrador.
- Quer pausar o envio por um tempo → desligue a chave; ligar de novo retoma em segundos.
