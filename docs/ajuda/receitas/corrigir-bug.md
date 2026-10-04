---
titulo: Corrigir um bug em produção
categoria: Projetos
ferramentas: Infra & logs · Projetos · Backend · Aprovações
tempo: 5 min seus
antes: O projeto no GitHub e, para ver logs, o container indicado no yui.json do projeto.
resultado: A causa encontrada, a correção feita e testada pelo agente, e o push só depois do seu OK.
frase: "Yui, o <problema> no <projeto> está dando erro, investiga e corrige."
---
# Corrigir um bug em produção

## Passo a passo
1. **Descreva o sintoma.** Diga o que acontece, onde e desde quando. Quanto mais concreto, menos voltas o agente dá.
   > Diga: "Yui, o checkout do Stoqmate dá erro 500 desde ontem à noite. Investiga e corrige."
2. **Ou parta dos logs.** Em Infra & logs, escolha o projeto em Logs por projeto. Se houver erros, clique em Pedir correção ao Backend.
3. **Acompanhe.** A execução aparece em Execuções com a Operação atual e a Timeline. Se demorar no caminho errado, clique em Cancelar e refaça o pedido.
4. **Aprove o push.** Quando o agente quiser rodar git push ou deploy, aparece a aprovação com o comando. Confira o projeto e aprove.
5. **Confirme.** Leia o Resultado da execução. Se quiser uma checagem extra, peça ao QA.
   > Diga: "Pede pro QA testar o checkout do Stoqmate de ponta a ponta."
