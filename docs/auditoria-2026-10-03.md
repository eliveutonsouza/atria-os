# Auditoria Yui Console — 2026-10-03

Relatório vivo: achado → correção → evidência. Frente A = delegação, missões, telas sob medida.

## Avaliação do cérebro (`server/scripts/eval-brain.ts`)

Bateria de 61 pedidos reais em pt-BR (59 contam; 2 dependem da frente de workflows). Roda `think({dryRun:true})`:
nenhuma tool executa, só registra. Rodar:

```
cd server && EVAL_CONC=3 YUI_DATA_DIR=/tmp/x YUI_WORKSPACE_DIR=/tmp/ws OPENAI_API_KEY=… npx tsx scripts/eval-brain.ts [filtro]
```

| Rodada | Acerto | Observação |
|---|---|---|
| Baseline (antes da frente A) | 49/59 = 83% | sem missões, sem telas sob medida, sem create_agent |
| Rodada intermediária | 37/59 → 48/59 | falhas eram **429 de limite de tokens/min** (6 pedidos em paralelo) |
| Final | 57/59 = 97% → 2 casos ajustados e revalidados (2×) | |

## Achados e correções

| # | Achado | Correção | Evidência |
|---|---|---|---|
| A1 | Voz: GPT-Live respondia sem delegar ("abri", "não tenho acesso") | Prompt "delegue tudo exceto cumprimentos"; **watchdog** no servidor: fala finalizada (1,2 s de silêncio) que não é small talk e não gerou delegação em 2,5 s → servidor chama o cérebro e responde via `commentary.append`; delegação tardia reaproveita a resposta (sem duplicar) | `live: watchdog` / `live: delegação … reaproveita watchdog` nos logs; classificador de small talk testado com frases reais do histórico |
| A2 | Só tarefas de 1 agente; nenhum plano visível | **Missões** (`missions.ts`): planner `gpt-6-sol` com saída estruturada (agentes restritos à lista real), DAG com dependências, resultados passados adiante, etapa arriscada pede aprovação **antes** de rodar, pausar/retomar/cancelar/tentar de novo, recuperação após reinício; view `mission` (grafo + etapas) | Missão real "Testar função soma": Backend criou `soma.test.js`, QA rodou 6/6 testes, em ordem; plano "publicar na Vercel + e-mail" marcou DevOps/Assistente como `risky`; e-mail rejeitado → etapa pulada sem criar run |
| A3 | 11 telas fixas | **Telas sob medida** (`customViews.ts`): `show_custom` (cérebro) + `display: blocks/html` nas delegações/etapas (agente grava JSON/HTML, servidor valida com zod e abre); HTML em iframe sandbox com token; view `custom` com KPIs, gráficos (barra/linha/área/pizza), tabela, lista, markdown seguro, timeline, imagem, link | "gráfico das execuções por agente e tabela de projetos" → tela aberta; QA listou arquivos com `display: blocks` → tela com KPIs + tabela abriu sozinha |
| A4 | Resultado do agente só virava fala | Fim de run: tela sob medida → abre; preview novo → website; relatório novo → report; senão sugere "Ver resultado". `GET /api/runs/:id/result-view`, botões "Ver resultado"/"Ver missão" no card | Playwright: sem erros de console nas views mission/custom/runs/dashboard |
| A5 | Cérebro não roteava agenda/e-mail/design/criação de agentes | Tabela de roteamento no prompt; `create_agent`; `get_run_result`; "abre o projeto X" = show_view | Eval 97% |
| A6 | **Limite de 200k tokens/min no gpt-6-luna** → 429 sob carga | `maxRetries: 4` (SDK respeita `retry-after`) | Rodada com 3 em paralelo sem 429 |
| A7 | Run cancelado aparecia como "falhou" | Abort → estado `cancelled`; etapa da missão marcada cancelada na hora | Cancelamento de missão em teste |
| A8 | Texto da Yui na tela com crases/negrito | Fala/tela sem marcação | — |

## Pendências conhecidas
- Watchdog validado por lógica e logs; falta teste com voz real do usuário.
- TopBar no celular: botões "pendências"/"Terminal" sobrepõem o botão YUI (fora da frente A).
- Gráficos com todos os valores zero aparecem como linhas finas (correto, mas pouco informativo).

## Validação integrada em produção (yui.eliveutonsouza.cloud, 2026-10-03)

| Verificação | Resultado |
|---|---|
| E2E Playwright (`e2e/run.mjs`, 26 checagens: todas as views, terminal, ⌘K, chat→views, gráfico sob medida, mobile, zero erros de página) | 26/26 ✓ (2 rodadas) |
| Eval do cérebro em produção (61 pedidos, dryRun) | 59/59 = 100% (baseline 83%) |
| Allowlist MCP por agente (run real) | ✗ bloqueava tudo ("Google Calendar" ≠ "claude.ai Google Calendar") → corrigido normalização → ✓ agente vê só Calendar |
| Workflow criado pela Yui via chat + execução real | ✓ Research → Research → Decisão (não) → Copy pulado → Fim |
| Contexto entre passos | ✗ `runs.result` truncado em 2000 chars (passo 2 recebeu passo 1 cortado) → limite 24k no run, 8k no contexto de workflow/missão |
| Missão real via chat (Backend → QA) | ✓ 6/6 testes |
| Evento Google Calendar via Assistente + aprovação | ✓ evento "Teste Yui" criado após aprovação |
| Narração de fim de workflow com voz | corrigido: usa `narrate()` (fala com GPT-Live ativo) |
| "Revisar alterações" de aprovação de workflow/missão | corrigido: abre workflow/missão certa |
| TopBar no celular sobrepondo | corrigido: botões compactos |

Pendente de teste humano: watchdog de voz com fala real (lógica revisada; frases reais do histórico classificadas corretamente).
