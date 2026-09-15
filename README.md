# 📊 Control Tower | Gerador de Programação

Ferramenta que converte a programação de rotas em PDF para planilhas Excel prontas para a operação logística.
Roda inteiramente no navegador, nenhum arquivo é enviado a servidores externos.

## O que faz

- Lê um ou mais PDFs de programação (pode selecionar vários de uma vez) e extrai rota, loja, dia/hora de entrega e carregamento, e volumes (caixas) — os registros de todos os arquivos são consolidados num único total antes de gerar o Excel
- Resolve o *CD de origem* e a *transportadora* de cada rota por uma tabela de referência embutida (prefixo da rota → CD → transportadora → planilha de saída)
- Cria automaticamente *linhas de retorno ao CD* para rotas elegíveis, com base no histórico acumulado
- Gera o Excel final preservando fórmulas e formatação do modelo original, *dividido em uma planilha por grupo de CD*, nomeada com a semana do faturamento (ex: Tbl_DistrMCD_ES_RJ_Sem35.xlsx)
- Para as rotas com CD faturamento × nomenclatura cadastrados na regra de carregamento (DTHCARREG), a data/hora de carregamento é recalculada a partir da data de entrega em vez de usar a preliminar do PDF

## Abas

- *Processar PDF*: fluxo principal (rotas McDonald's), com tabela de referência e regra DTHCARREG próprias
- *Outback*: aba separada para os PDFs de operações Outback/Abbraccio (lojas no formato `MARCA-LOJA`, ex: `OUT-PSH`) — tabela de referência, resolução de origem e histórico de retorno completamente isolados da aba principal; sempre segue a preliminar do PDF (sem DTHCARREG)

## Configuração

Fica na aba *Configurações* do site (para a aba Processar PDF) ou dentro da própria aba Outback, ou direto nos arquivos de dados:

- *Prefixo → CD → Transportadora → Planilha*: única fonte para origem, elegibilidade de retorno automático e agrupamento do Excel de saída — `data/prefixo_cd_transportadora.js` (Processar PDF) e `data/prefixo_cd_transportadora_outback.js` (Outback)
- *Regra de carregamento (DTHCARREG)*: `data/regra_carregamento.js` — só se aplica à aba Processar PDF
- *Origem padrão*: usada só quando o prefixo da rota não está cadastrado na tabela (uma para cada aba)

## Limitações conhecidas

- Retorno automático ao CD só é criado para rotas com evidência histórica prévia — rotas novas não recebem
- As tabelas de referência não são editáveis pela interface; atualizações exigem substituir o arquivo de dados
