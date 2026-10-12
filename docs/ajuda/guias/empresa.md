---
titulo: Empresa
grupo: Conhecimento
pagina: company
ordem: 1
resumo: O que a Yui e os agentes sabem sobre a sua empresa: um perfil fixo e uma base de documentos que eles consultam com citação.
usar_quando: Para ensinar o negócio aos agentes (serviços, preços, tom, público) e para guardar contratos, tabelas e processos que eles devem consultar.
nao_usar_quando: Para anotações livres, decisões e histórico de trabalho, use o Vault.
frases:
  - "Yui, quanto custa um site institucional e o que está incluso?"
  - "O que diz o contrato da clínica sobre multa por atraso?"
  - "Abre os documentos da empresa."
dicas:
  - Preencha o Perfil primeiro. Ele entra no início de toda conversa da Yui e de toda execução de agente.
  - Envie a tabela de preços e um modelo de proposta: os agentes passam a citar valores dos documentos em vez de inventar.
  - Em Como funciona a busca, a lista de perguntas sem resposta mostra quais documentos estão faltando.
  - Corrija os Dados extraídos de um documento quando a leitura errar; clique em Salvar dados.
erros:
  - Excluir um documento achando que dá para recuperar. A exclusão apaga o arquivo, o texto lido, a busca da Yui e a nota no vault, e não tem volta.
  - Colocar preços só no Perfil e esquecer de atualizar. Prefira a tabela em PDF na base; o Perfil fica para o resumo.
relacionados: [vault, falar-com-a-yui, agentes]
---
# Empresa

## O que é
Tem três abas. **Perfil**: nome, razão social, CNPJ, segmento, site, cidade, o que a empresa faz, para quem, tom de voz, serviços e preços e logo. **Documentos**: PDFs, DOCX, PPTX, XLSX, TXT, MD e imagens escaneadas. O Atria lê o texto (até de foto), resume e prepara cada documento para a busca. **Como funciona a busca**: o caminho de cada arquivo até ficar pronto para a Yui e o campo "Perguntar à base". A Yui e os agentes consultam essa base e citam documento e página.

## Passo a passo
1. **Preencha o Perfil.** Complete os campos, escolha o Tom de voz e liste Serviços e preços. Clique em **Salvar perfil**. O quadro "Como os agentes vão ver" mostra o texto exato que eles recebem.
2. **Envie documentos.** Em Documentos, arraste os arquivos ou clique para escolher (até 50 MB cada, vários de uma vez). A barrinha de etapas mostra a leitura em andamento (Recebido, Lendo, Extraindo dados, Preparando busca, Pronto para a Yui consultar).
3. **Confira a leitura.** Abra um documento: aba Dados extraídos (editável), Texto (OCR), Trechos e Uso pela IA. Ajuste a categoria se precisar.
4. **Teste a base.** Em Como funciona a busca, use **Perguntar à base**. A resposta usa só os trechos encontrados e cita a fonte.
5. **Mantenha.** Reprocessar lê de novo um documento (avisa quando termina); Excluir apaga de tudo, depois de confirmar em "Excluir definitivamente". Para ir a uma página de um documento longo, use **Anterior**, **Próxima** ou **Ir para página**.

## O que você vê na tela
- Categorias: Comercial, Contratos, Marca, Processos, Financeiro, Clientes, Outros.
- Saúde dos serviços (leitura, banco, busca e IA): fica recolhida em "Detalhes técnicos", no rodapé da lista.
- "Também no vault": cada documento vira uma nota ligada à nota Empresa e aparece no Cérebro.
- Uso pela IA: quando a Yui ou um agente consultou aquele documento.

## Exemplos do dia a dia
- Proposta nova → os agentes puxam preços e escopo da tabela enviada.
- Cliente pergunta sobre prazo de garantia → "Yui, o que diz nosso contrato padrão sobre garantia?"
- Mudou o preço de um serviço → envie a tabela nova, exclua a antiga e atualize o Perfil.
