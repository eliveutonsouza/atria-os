---
nome: Post Instagram
descricao: Pesquisa tendências, escreve a legenda, gera a imagem e publica no Instagram depois da sua aprovação.
gatilho: manual
time: [research, copy, designer, assistente]
---

# Post Instagram

```mermaid
flowchart TD
  n1["1. Pesquisar tendências<br/>research"]
  n2["2. Escrever legenda<br/>copy"]
  n3["3. Gerar imagem do post<br/>designer"]
  n4{"4. Qualidade ok?"}
  n5{{"5. Revisão humana"}}
  n6["6. Publicar<br/>assistente"]
  n7(("7. Fim"))
  n1 --> n2
  n2 --> n3
  n3 --> n4
  n4 -->|sim| n5
  n4 -->|não| n2
  n5 --> n6
  n6 --> n7
  classDef t_start fill:#1b2045,stroke:#8c92ad,color:#e8eaf4
  classDef t_task fill:#0f1f33,stroke:#67d8f2,color:#e8eaf4
  classDef t_decision fill:#2a2110,stroke:#f5b54a,color:#ffe7b8
  classDef t_approval fill:#221a3d,stroke:#a68cf7,color:#e6ddff
  classDef t_parallel fill:#1d1b38,stroke:#cbbcff,color:#e8eaf4
  classDef t_end fill:#1b2045,stroke:#8c92ad,color:#e8eaf4
  class n1,n2,n3,n6 t_task
  class n4 t_decision
  class n5 t_approval
  class n7 t_end
```

## 1. Pesquisar tendências
- tipo: tarefa
- agente: research
- instrução: Pesquise 3 temas em alta para o público do perfil (desenvolvimento, IA aplicada a negócios, produtividade). Para cada tema traga gancho, ângulo e por que deve engajar. Use busca na web e Firecrawl quando útil.
- mcp: [Firecrawl, Apify]
- saída: temas

## 2. Escrever legenda
- tipo: tarefa
- agente: copy
- instrução: Escolha o tema mais forte entre os pesquisados e escreva legenda para Instagram em português (gancho na 1ª linha, até 150 palavras, CTA e 5–8 hashtags). Sugira também o texto da arte (no máximo 8 palavras).
- saída: legenda

## 3. Gerar imagem do post
- tipo: tarefa
- agente: designer
- instrução: Crie a arte quadrada 1080x1080 para o post usando o texto da arte e a identidade do perfil. Use Higgsfield (generate_image) ou Claude Design. Entregue o link/arquivo da imagem final.
- mcp: [Higgsfield]
- saída: imagem

## 4. Qualidade ok?
- tipo: decisão
- condição: A legenda e a imagem estão prontas para publicar (tema forte, texto sem erros, arte legível e alinhada à legenda)?

## 5. Revisão humana
- tipo: aprovação
- instrução: Revise legenda e imagem antes da publicação.

## 6. Publicar
- tipo: tarefa
- agente: assistente
- instrução: Publique a imagem com a legenda no Instagram via Composio (ou Facebook/Instagram quando autorizado). Se nenhum conector puder publicar, salve legenda e imagem no Google Drive na pasta "Instagram/Pendentes" e avise.
- mcp: [composio, Google Drive]

## 7. Fim
- tipo: fim
