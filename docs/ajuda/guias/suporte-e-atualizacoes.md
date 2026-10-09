---
titulo: Suporte e atualizações
grupo: Sistema
pagina: settings
ordem: 5
resumo: Decide se a equipe Atria pode entrar na sua conta para ajudar e se aceita as atualizações que ela manda; mostra cada acesso, os avisos da equipe e a versão instalada.
usar_quando: Quando a equipe Atria vai te ajudar por acesso remoto, quando chegou um aviso no topo ou para conferir a versão e as atualizações.
nao_usar_quando: Para ligar o envio de métricas ao Atria Central, use o guia Monitoramento remoto.
frases:
  - "Yui, quem acessou minha conta como suporte?"
  - "Como encerro o acesso do suporte?"
  - "Como paro as atualizações automáticas?"
  - "Qual versão do Atria OS está instalada?"
dicas:
  - Enquanto o suporte está dentro, a faixa "Suporte conectado" fica no topo de todas as telas com **Encerrar acesso**.
  - O acesso do suporte dura no máximo 2 h e acaba sozinho. Trocar a senha também encerra na hora.
  - A sessão de suporte não troca a sua senha nem liga ou desliga estas opções. Só você muda.
  - Antes de atualizar, o Atria OS espera as execuções em andamento terminarem (até 20 min). As novas esperam na fila e voltam a rodar depois.
  - Se a versão nova não ficar saudável em 3 min, o Atria OS volta sozinho para a anterior.
erros:
  - Desligar "Permitir que a equipe Atria acesse" e pedir ajuda remota. O link do suporte é recusado até você ligar de novo.
  - Desligar "Aceitar atualizações" e esquecer. As correções e novidades ficam paradas até você ligar.
relacionados: [monitoramento, configuracoes, celular]
---
# Suporte e atualizações

## O que é
Quem administra o seu Atria OS (a equipe Atria, pelo Atria Central) pode fazer três coisas, sempre à vista:
- **Suporte remoto:** entrar na sua conta para ajudar, sem pedir a sua senha. Cada acesso abre a faixa "Suporte conectado" no topo, manda uma notificação ao celular e fica registrado em Acessos recentes.
- **Avisos:** mensagens da equipe (manutenção, novidades, alertas) que aparecem numa faixa no topo até você tocar em **Entendi**. Avisos amarelos e vermelhos também chegam como notificação.
- **Atualizações:** a equipe atualiza o Atria OS para uma versão nova, na hora ou agendada. Um dia antes aparece um aviso; depois, "Atria OS atualizado para vX".

## Passo a passo
1. **Abra Configurações › Suporte e atualizações.**
2. **Suporte remoto.** Ligue ou desligue "Permitir que a equipe Atria acesse para ajudar" (vem ligado). Em Acessos recentes você vê data, duração e como cada acesso terminou.
3. **Encerrar um acesso.** Toque em **Encerrar acesso** na faixa do topo ou no quadro Suporte remoto. A equipe sai na hora.
4. **Avisos.** Leia o aviso no topo e toque em **Entendi**. Ele some daqui e a equipe vê que você leu.
5. **Atualizações.** Confira a versão instalada e, se houver, a atualização em andamento. Para pausar, desligue "Aceitar atualizações da equipe Atria".

## O que você vê na tela
- Faixa ciano "Suporte conectado · desde 16:20, expira 18:20" com **Encerrar acesso**.
- Faixa do aviso (azul, amarela ou vermelha) com o título, a mensagem, "Aviso da equipe Atria · hoje 09:12" e **Entendi**.
- Toast verde "Atria OS atualizado para vX" depois de uma atualização.
- Em Configurações: Acessos recentes ("ontem 16:20 · 35 min · encerrado por você"), Versão instalada, o andamento da atualização (esperando as execuções, baixando a nova versão) e o estado do Atualizador (pronto, atualizando, com erro ou não instalado).

## Exemplos do dia a dia
- A equipe pediu para olhar um problema → deixe o acesso ligado; quando ela entrar, a faixa aparece. Terminou? **Encerrar acesso**.
- Não quer acesso de ninguém por um tempo → desligue "Permitir que a equipe Atria acesse".
- Chegou "Manutenção sábado 22h" → leia e toque em **Entendi**; no horário o Atria OS espera as execuções terminarem e atualiza.
- Atualizador "não instalado" → esta instalação foi feita com build na VPS e se atualiza com ./install.sh --update.
