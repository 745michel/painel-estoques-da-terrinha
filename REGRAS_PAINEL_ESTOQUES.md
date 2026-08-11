# Regras permanentes do painel Controle de Estoques

Este arquivo registra as decisões aprovadas durante a construção do painel. Deve ser lido antes de qualquer atualização, correção ou publicação.

## Fontes reais

- Terceiros: `C:\Users\Daterrinha63\daterrinhaalimentos.com.br\DT - PCP - DADOS\Planilha - Atualização\Terceiro Estoque X Pedido.xlsm`
- Embalagens e matérias-primas: `C:\Users\Daterrinha63\daterrinhaalimentos.com.br\DT - PCP - DADOS\Planilha - Atualização\EMBALAGEM Estoque X Pedido.xlsm`
- Não usar anexos, cópias ou planilhas-modelo.
- Antes de extrair dados operacionais, abrir as duas bases no Microsoft Excel, atualizar conexões, consultas e fórmulas, salvar e fechar. Se uma base estiver aberta, bloqueada ou falhar, não publicar dados antigos.

## Horários

- Todas as bases devem ser atualizadas diariamente às 08:30.
- Ordem obrigatória: primeiro Terceiros e Embalagens/MP no Excel; depois Valor dos Insumos no Power BI; por último regenerar, validar e publicar o painel.
- Se qualquer etapa falhar, interromper a rotina e não publicar dados antigos ou parcialmente atualizados.

## Unidades

- Terceiros: `cx`, sem casas decimais.
- Bobinas: `kg`.
- Matérias-primas: `kg`.
- Caixas e demais embalagens: `unidades`.
- Cobertura: número inteiro de dias.

## Classificação dos filtros de embalagens

Ordem: Matérias-primas, Bobinas e depois as demais categorias.

- Bobinas: todas as bobinas, incluindo bobinas para fardos.
- Caixas: caixas comuns.
- Cartuchos: caixas/cartuchos e grafias equivalentes.
- Potes e baldes: potes, BALDE LISO OKKER 2.2, BALDE LISO OKKER 3.2, baldes SGF e bisnagas.
- Sacos pouch: todos os sacos pouch.
- Etiquetas: etiquetas, rótulos e sachês.
- Sacos, fardos e stretch: sacos plásticos, sacos para fardos, stretch e selo fecha-fácil.
- Tampas: todas as tampas.
- Outras embalagens: somente itens que não se enquadram acima. Ocultar a opção quando estiver vazia.
- `MP – SUSPENSÃO OLEOSA URUCUM KG` é matéria-prima.
- `ETIQ ALHO FRITO POTE OKKER 250G` permanece em outras embalagens, não em potes.

## Filtros e tabela

- Permitir seleção única ou múltipla.
- Produto/material deve permitir pesquisa digitada e mostrar o nome completo ao passar o mouse.
- Fechar o menu de seleção ao clicar fora, sem limpar os filtros persistentes.
- Somente os cartões de visão rápida podem voltar para “Todos” ao clicar fora.
- Mostrar somente os nomes das lojas, sem códigos.
- Mapeamento: 1 = Da Terrinha - Matriz; 2 = J E Comércio; 10 = Okker - Matriz; 11 = 2JM; 14 = Da Terrinha - Filial SP.
- Destacar a linha selecionada com cor clara.
- Congelar produto até status e manter cabeçalhos/filtros visíveis durante a rolagem.
- Datas de entrega em atraso devem ficar vermelhas nas visões de terceiros e de embalagens/MP.
- Produtos sem projeção/consumo devem ficar no final da lista.
- Ao escolher ou pesquisar um produto, a tabela deve mostrar somente os itens efetivamente selecionados.
- As chaves das linhas da interface devem incluir loja, SKU e nome completo do produto. Não usar apenas loja + SKU, pois descrições diferentes podem compartilhar o mesmo SKU e provocar linhas antigas ou repetidas após a filtragem.

## Status visual de estoque

Estas regras afetam somente a visão do painel, nunca as planilhas ou o sistema de origem.

- Usar consumo diário, lead time, estoque de segurança e primeira entrega programada.
- Ponto de pedido = consumo diário × lead time + estoque de segurança.
- Falta crítica: estoque projetado na primeira entrega menor ou igual a zero.
- Estoque baixo: abaixo do ponto de pedido ou abaixo da segurança na primeira entrega.
- Produto com cobertura acima da segurança configurada (20 ou 30 dias) não pode ser classificado como estoque baixo apenas pela cobertura.
- Nível ideal: operação dentro da faixa planejada.
- Excesso: acima do estoque máximo, considerando lote mínimo e tolerância operacional de 20%.
- O texto exibido é “Estoque baixo”, nunca “Risco de falta”.

## Valor dos insumos — regra crítica

- Fonte: Power BI `Estoque x Pedidos - Todas as Filiais`, página `ESTOQUE R$`.
- Campo de custo obrigatório: **`ficha_custo.custo_contabil`**.
- Usar o valor por `loja_key` e produto. Não copiar custo de uma loja para outra.
- Campo de valor atual do estoque: `ESTOQUE R$`.
- Confirmar o horário “Atualizado em” do BI.
- Antes da extração, usar `Redefinir para padrão`. Em seguida, selecionar explicitamente a **data mais recente disponível** no filtro `DATA` e aguardar a tabela terminar de carregar. Confirmar que LOJA, DEPARTAMENTO, CATEGORIA, GRUPO DO PRODUTO, PRODUTO e Ano/Mês/Dia estão em `Todos` ou sem seleção.
- Nunca extrair a tabela com `DATA` sem seleção: esse estado pode retornar apenas o cabeçalho e gerar custos ausentes. A data selecionada deve coincidir com o último dia disponível no relatório e deve ser registrada junto com o horário “Atualizado em”.
- Extrair a tabela completa da data mais recente, sem os demais filtros, para não perder estoques classificados em outro departamento ou outra seleção do Power BI.
- Na construção da aba financeira, manter como catálogo adicional somente as categorias 17-FECULA, EMBALAGEM PRIMARIA, EMBALAGEM QUARTENARIA, EMBALAGEM SECUNDARIA, EMBALAGEM TERCIARIA, ETIQUETAS E ROTULOS e MATERIA PRIMA. Produtos da planilha operacional podem localizar seus valores na captura completa independentemente da categoria do BI.
- Não incluir TERCEIRIZADOS na aba Valor dos Insumos.

### Paginação dinâmica do Power BI

- A tabela carrega dados em blocos e o `aria-rowcount` inicial não representa necessariamente o total.
- Nunca encerrar a extração no primeiro bloco de 499 linhas.
- Continuar rolando até localizar a linha visível `Total`.
- Revalidar o total após cada carregamento de bloco.
- Conferir que todos os índices entre o cabeçalho e a linha `Total` foram capturados, sem lacunas.
- Como teste de controle, `BOBINA TAPIOCA DA TERRINHA 1 KG` deve retornar, na posição de 28/07/2026:
  - loja 1: ESTOQUE R$ 217.611,11 e ficha contábil 24,74;
  - loja 2: ESTOQUE R$ 0,00 e ficha contábil 0,00;
  - loja 14: ESTOQUE R$ 31.548,37 e ficha contábil 25,02.
- Se um produto conhecido não aparecer na captura geral, pesquisá-lo diretamente no filtro PRODUTO antes de concluir que o custo não existe.
- Não estimar custos. Itens sem correspondência segura devem permanecer identificados.

### Cobertura completa do catálogo financeiro

- A aba `Valor dos insumos` deve ser a união dos itens da base operacional com todos os registros extraídos do Power BI nas categorias autorizadas.
- Um item existente somente no Power BI não pode ser descartado por não constar em `dados-insumos.json`.
- Esses itens devem permanecer separados por loja, identificados como `Somente no Power BI`, com o custo contábil exato da respectiva loja.
- Não atribuir entregas programadas a um item exclusivo do Power BI sem uma correspondência segura com a base operacional.
- Manter inclusive registros com `ESTOQUE R$ 0,00` quando houver ficha contábil, pois eles são necessários para conferir o custo por loja.
- Como controle adicional, `09022 - FECULA MANDIOCA 40 KG` deve aparecer nas lojas 7 e 11, respectivamente com ficha contábil 1,42 e 1,76, conforme a extração de 29/07/2026.
- Códigos de loja sem nome confirmado não devem ser convertidos por suposição; exibir `Loja não identificada (código X)` até o mapeamento ser validado.

## Publicação

- Preservar o mesmo projeto e endereço definidos em `.openai/hosting.json`.
- Compilar e validar antes de publicar.
- Conferir produtos, lojas, unidades, entregas programadas, custos localizados/não localizados e totais financeiros.
- Publicar somente uma nova versão privada e manter o mesmo link.

## Acesso por e-mail

- A equipe operacional autorizada no Sites pode visualizar apenas `Estoque de terceiros` e `Embalagens e MP`.
- A lista operacional solicitada é: `dilma@daterrinhaalimentos.com.br`, `vitor@daterrinhaalimentos.com.br`, `hamilton@daterrinhaalimentos.com.br`, `sabrina@daterrinhaalimentos.com.br` e `marta@daterrinhaalimentos.com.br`.
- A aba `Valor dos insumos` e seus dados devem ser liberados somente no servidor para `bi.compras@daterrinhaalimentos.com.br` e `gisella@daterrinhaalimentos.com.br`.
- Nunca publicar `dados-valores-insumos.json` dentro de `public/`; o arquivo deve permanecer em `data/dados-valores-insumos.json`.
- Ocultar a aba no navegador não é proteção suficiente: o servidor deve validar `oai-authenticated-user-email` antes de enviar qualquer dado financeiro.

## Consumo de insumos

- A aba `Consumo de insumos` é exclusiva para produtos da base Embalagens e MP e pode ser vista pela equipe operacional.
- Fonte de movimentos: tabela `movimento_estoque` que alimenta o Power BI `movimento estoque producao`, visual `Movimentos de saída para produção`.
- A conexão `Consulta - movimento_estoque` da planilha está configurada com `RefreshWithRefreshAll=False`; o processo deve atualizá-la explicitamente e falhar se ela não puder ser atualizada.
- Na atualização diária, executar `work/sheet-inspect/extract_consumption_history.ps1` e depois `work/sheet-inspect/build_consumption_history.py` para regenerar `public/dados-consumo-insumos.json`.
- Validar a data máxima da extração e exibir claramente a data de corte. Nunca apresentar o mês como fechado quando ele ainda for parcial.
- Considerar como consumo líquido: `Saída para Composição - Estorno Saída para Composição`.
- Manter os dados separados por produto, SKU e loja. Nunca somar `kg` com `unidades` no mesmo indicador.
- Exibir filtros de categoria, loja, fornecedor e produto/material, todos com seleção múltipla e pesquisa de produto.
- Manter filtro de ano e permitir selecionar o mês clicando nas barras.
- Sem mês selecionado, exibir o total de todos os meses do ano. Ao clicar fora do gráfico, limpar a seleção mensal e retornar ao total anual.
- A seção inferior não deve repetir os meses do gráfico. Usar a fila de ação do comprador, cruzando consumo do mês, média dos três meses anteriores, variação, cobertura, próxima entrega e recomendação.
- Na análise de consumo, não exibir a coluna Loja nem uma coluna de consumo total anual; o total anual permanece somente nos indicadores superiores.
- Exibir Realizado do mês, Escadinha atual, variação do Realizado versus Escadinha, Estoque atual, Cobertura e Próxima entrega; não exibir a coluna Recomendação.
- Ordenar os produtos do maior para o menor realizado. Produtos sem realizado no mês devem permanecer no final da fila.
- A seleção de produto deve ajustar automaticamente a unidade do gráfico, permitindo abrir matérias-primas, caixas, potes, etiquetas e demais embalagens, além de bobinas.
- A tabela da aba Consumo de insumos não deve ter colunas ou cabeçalho congelados.
- A seleção de produto deve permanecer em cada aba enquanto a página estiver aberta. Ao recarregar a página, os filtros retornam ao estado inicial.
