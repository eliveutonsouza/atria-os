---
nome: Revisão semanal dos repositórios
descricao: Revisa segurança e dependências dos projetos ativos e gera relatório executivo. Sugestão de agenda: segundas às 9h (0 9 * * 1).
gatilho: manual
time: [security, report]
---

# Revisão semanal dos repositórios

```mermaid
flowchart TD
  n1["1. Revisão de segurança<br/>security"]
  n2["2. Relatório executivo<br/>report"]
  n3(("3. Fim"))
  n1 --> n2
  n2 --> n3
  classDef t_start fill:#1b2045,stroke:#8c92ad,color:#e8eaf4
  classDef t_task fill:#0f1f33,stroke:#67d8f2,color:#e8eaf4
  classDef t_decision fill:#2a2110,stroke:#f5b54a,color:#ffe7b8
  classDef t_approval fill:#221a3d,stroke:#a68cf7,color:#e6ddff
  classDef t_parallel fill:#1d1b38,stroke:#cbbcff,color:#e8eaf4
  classDef t_end fill:#1b2045,stroke:#8c92ad,color:#e8eaf4
  class n1,n2 t_task
  class n3 t_end
```

## 1. Revisão de segurança
- tipo: tarefa
- agente: security
- instrução: Nos repositórios clonados em /workspace com commits nos últimos 7 dias, rode auditoria de dependências (npm audit ou equivalente) e procure segredos expostos. Liste achados por severidade com arquivo:linha. Não altere código.
- saída: achados

## 2. Relatório executivo
- tipo: tarefa
- agente: report
- instrução: Gere o relatório semanal (Destaques, Riscos, Próximas ações) a partir dos achados de segurança e do git log da semana dos projetos ativos.

## 3. Fim
- tipo: fim
