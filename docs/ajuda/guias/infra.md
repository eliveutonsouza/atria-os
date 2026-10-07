---
titulo: Infra & logs
grupo: Sistema
pagina: infra
ordem: 1
resumo: A saúde da sua VPS (CPU, RAM, disco e containers) e os logs de cada projeto, com um botão para pedir correção.
usar_quando: Quando algo está lento ou fora do ar, ou para ler os erros recentes de um projeto.
nao_usar_quando: Para ver o que os agentes estão fazendo, use Operações.
frases:
  - "Yui, como está a VPS?"
  - "Mostra os logs do Stoqmate."
  - "Tem algum container com problema?"
dicas:
  - Escolha um projeto em "Logs por projeto" para ver as linhas mais recentes do container dele.
  - Quando há erros, "Pedir correção ao Backend" cria a tarefa já com os logs como ponto de partida.
  - O Atria OS só lê os containers; ele não reinicia nada por esta tela.
erros:
  - Projeto sem logs. É preciso indicar o container no atria.json do projeto.
relacionados: [projetos, terminal, operacoes]
---
# Infra & logs

## O que é
Mostra a VPS ao vivo: uso de CPU, RAM e disco, quantos containers estão saudáveis e quantos pedem atenção, e a lista de containers com estado. Abaixo, os logs do container de cada projeto.

## Passo a passo
1. **Olhe os medidores.** CPU, RAM e Disco mudam de cor quando sobem demais.
2. **Veja os containers.** SAUDÁVEIS e ATENÇÃO no topo; a lista mostra o estado de cada um.
3. **Abra os logs.** Em **Logs por projeto**, escolha em "Escolha um projeto…".
4. **Peça a correção.** Se houver erros, clique em **Pedir correção ao Backend**.
5. **Vá ao terminal** pelo botão **Terminal** do topo, se quiser investigar você mesmo.

## O que você vê na tela
- Linhas de log com hora, nível (ERROR em vermelho) e mensagem.
- Resumo do que foi encontrado nos logs.

## Exemplos do dia a dia
- Disco perto do limite → peça ao DevOps "verifica o que está ocupando disco na VPS e me sugere o que limpar".
- Cliente reclamou de erro → logs do projeto e Pedir correção ao Backend.
