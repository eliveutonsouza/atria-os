---
titulo: Checar se os sites dos clientes estão no ar
categoria: Rotina
ferramentas: Agendamentos · QA · Navegador · Execuções
tempo: 5 min seus, uma vez
antes: A lista de endereços que você quer vigiar.
resultado: Uma rotina que abre os sites no horário marcado e diz no resultado qual site não respondeu.
frase: "Yui, a cada hora pede pro QA abrir <sites> e me avisar se algum estiver fora do ar."
---
# Checar se os sites dos clientes estão no ar

## Passo a passo
1. **Crie a rotina.** Peça à Yui ou vá em Agendamentos › + Nova rotina › Instrução para um agente.
   > Diga: "Yui, todo dia às 8h pede pro QA abrir fisioforma.com.br e loja-exemplo.com.br, conferir se carregam e se o formulário de contato aparece, e me dizer no resultado qual não abriu."
2. **Preencha pela tela, se preferir.** Nome "Checagem de sites", Agente QA, Instrução com os endereços e o que conferir, Quando "Todo dia 8h" ou "A cada hora". Clique em Salvar rotina.
3. **Teste.** Clique em Rodar agora e assista em Navegador ao vivo.
4. **Receba o resultado.** Cada checagem aparece em Execuções. Com notificações ativas, chega no celular o aviso "QA concluiu" com o começo do resultado (ou "QA não conseguiu concluir", se a execução falhar).
5. **Corrija.** Abra a execução, leia o Resultado e peça a correção ao agente certo.
