---
nome: Leads diários
descricao: Encontra empresas com oportunidade de site/CRM, qualifica e registra no Twenty. Sugestão de agenda: dias úteis às 8h (0 8 * * 1-5).
gatilho: manual
time: [research, assistente]
---

# Leads diários

```mermaid
flowchart TD
  n1["1. Buscar empresas<br/>research"]
  n2["2. Qualificar<br/>research"]
  n3{"3. Tem leads bons?"}
  n4["4. Registrar no CRM<br/>assistente"]
  n5(("5. Fim"))
  n1 --> n2
  n2 --> n3
  n3 -->|sim| n4
  n3 -->|não| n5
  n4 --> n5
  classDef t_start fill:#1b2045,stroke:#8c92ad,color:#e8eaf4
  classDef t_task fill:#0f1f33,stroke:#67d8f2,color:#e8eaf4
  classDef t_decision fill:#2a2110,stroke:#f5b54a,color:#ffe7b8
  classDef t_approval fill:#221a3d,stroke:#a68cf7,color:#e6ddff
  classDef t_parallel fill:#1d1b38,stroke:#cbbcff,color:#e8eaf4
  classDef t_end fill:#1b2045,stroke:#8c92ad,color:#e8eaf4
  class n1,n2,n4 t_task
  class n3 t_decision
  class n5 t_end
```

## 1. Buscar empresas
- tipo: tarefa
- agente: research
- instrução: Use o Apify (Google Maps) para encontrar até 30 empresas locais em São Paulo de nichos de serviço (clínicas, escritórios, academias). Para cada uma colete nome, site, telefone, Instagram e nota no Google.
- mcp: [Apify, Firecrawl]
- saída: empresas

## 2. Qualificar
- tipo: tarefa
- agente: research
- instrução: Dê score 0–100 de oportunidade (sem site, site fraco, sem conversão, presença ativa) e escolha as 10 melhores com o motivo e a oferta recomendada (site, CRM, automação).
- saída: qualificados

## 3. Tem leads bons?
- tipo: decisão
- condição: Existe pelo menos 1 empresa com score acima de 70?

## 4. Registrar no CRM
- tipo: tarefa
- agente: assistente
- instrução: Cadastre as empresas qualificadas (score > 70) no Twenty esm-softwares como companies com nota contendo score, motivo e oferta. Não envie mensagens a ninguém.
- mcp: [Twenty esm-softwares]

## 5. Fim
- tipo: fim
