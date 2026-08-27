# Painel Controle de Estoques — Da Terrinha

Painel interno de cobertura de estoque para a equipe de compras. Next.js 16 (App Router, RSC)
rodando sobre [vinext](https://github.com/cloudflare/vinext) em Cloudflare Workers, publicado
como site privado na plataforma OpenAI Sites.

## Antes de qualquer alteração

**Leia [REGRAS_PAINEL_ESTOQUES.md](REGRAS_PAINEL_ESTOQUES.md).** É o contrato do painel: fontes
de dados válidas, unidades por categoria, classificação de embalagens, regras de status visual,
regras críticas de custo do Power BI, mapeamento de lojas e regras de publicação. Decisões já
aprovadas estão lá — não reinterprete nem contradiga sem o usuário pedir explicitamente.

Pontos que costumam ser violados por engano:

- Unidades nunca se somam: `cx` (terceiros), `kg` (bobinas e MP), `unidades` (demais embalagens).
- O texto de status é **"Estoque baixo"**, nunca "Risco de falta".
- Chave de linha da tabela = loja + SKU + **nome completo** do produto (SKU repetido entre
  descrições diferentes gera linhas fantasma se a chave for só loja+SKU).
- Custo obrigatoriamente de `ficha_custo.custo_contabil`, por `loja_key`. Nunca copiar custo
  entre lojas, nunca estimar.
- `data/dados-valores-insumos.json` **nunca** pode ir para `public/`.

## Comandos

```powershell
npm run dev       # dev server em http://localhost:3000
npm run build     # build de produção (dist/)
npm run start     # serve o build
npm run lint      # eslint — hoje: 0 erros, 8 warnings
npm run db:generate  # migrations Drizzle após mexer em db/schema.ts
```

`npm test` **está quebrado e é esperado que esteja** — `tests/rendered-html.test.mjs` é o teste
do template `vinext-starter` original: ele exige o esqueleto de carregamento
(`app/_sites-preview/SkeletonPreview.tsx`, `react-loading-skeleton`, título "Starter Project"),
que o painel real substituiu. É lixo herdado, não uma regressão. Precisa ser reescrito como
smoke test do painel antes de voltar a valer alguma coisa.

## Arquitetura

```
app/page.tsx            RSC. Lê o header oai-authenticated-user-email e decide o acesso
                        financeiro; injeta valoresData só para e-mails autorizados.
app/DashboardClient.tsx Client component único (~83 KB) com as 4 seções do painel.
app/layout.tsx          Metadata pt-BR, fontes Geist.
app/globals.css         Todo o estilo (44 KB), sem framework de UI.
worker/index.ts         Entry do Cloudflare Worker: otimização de imagem + handler vinext.
vite.config.ts          Simula os bindings D1/R2 declarados em .openai/hosting.json.
build/sites-vite-plugin.ts  Empacota .openai/hosting.json e drizzle/ em dist/.openai no build.
db/schema.ts            Vazio — o painel não usa banco, os dados vêm de JSON estático.
```

As 4 seções (`type Section`) são `terceiros`, `insumos`, `consumo` e `valores`.

### Fluxo de dados

Os dados são **JSON estático importado em build time**, não API:

| Arquivo | Seção | Origem |
| --- | --- | --- |
| `public/dados-estoque.json` | terceiros | `Terceiro Estoque X Pedido.xlsm` |
| `public/dados-insumos.json` | insumos | `EMBALAGEM Estoque X Pedido.xlsm` |
| `public/dados-consumo-insumos.json` | consumo | tabela `movimento_estoque` (Power BI) |
| `data/dados-valores-insumos.json` | valores | Power BI `ESTOQUE R$` + `ficha_custo.custo_contabil` |

Os `.xlsm` de origem ficam em
`C:\Users\Daterrinha63\daterrinhaalimentos.com.br\DT - PCP - DADOS\Planilha - Atualização\` —
essa pasta é a biblioteca do SharePoint sincronizada localmente (confirmado 05/08/2026), não uma
cópia isolada. `movimento_estoque` (consumo) e `ficha_custo`/`ficha_estoque` (valor dos insumos)
vêm do mesmo banco Postgres que alimenta o Power BI, acessível pelo DSN ODBC `PostgreSQL35W`
já configurado nesta máquina.

### Automação (05/08/2026, totalmente automática desde 20/08/2026)

**Tarefa agendada única `AtualizarEPublicarPainel`** (`Get-ScheduledTask -TaskName
AtualizarEPublicarPainel`), 3x por dia (08:10, 14:00, 15:30) →
`automation\atualizar_e_publicar_tudo.ps1`. Antes eram 3 tarefas separadas
(`AtualizarPainelEstoques`, `AtualizarEscadinha`, `AtualizarPedidosVenda`), cada uma publicando
por conta própria — unificadas numa só em 20/08/2026 porque, rodando no mesmo horário, cada
uma tentando dar `git push` sozinha podia disputar o repositório. Also a partir de 20/08/2026 a
**publicação (commit + push) passou a ser automática** — pedido explícito do usuário
("quero usar você só pra criar novos relatórios e melhorias, os dados têm que vir
automático"). Ninguém mais precisa pedir pra atualizar ou publicar o painel; só pra
mudar/criar algo novo.

O script roda 3 pipelines, cada uma independente (uma falhar não trava as outras — fica com o
último dado bom, e só os arquivos das pipelines que deram certo entram no commit):

1. **Terceiros/Embalagens/MP/Consumo** (`automation\atualizar_dados.ps1`):
   1. `work/sheet-inspect/refresh_workbooks.ps1 -Alvo Todos` — Excel COM abre as duas
      planilhas, `RefreshAll()`, atualiza explicitamente a conexão `Consulta -
      movimento_estoque` (tem `RefreshWithRefreshAll=False`), salva e fecha. Guarda contra
      arquivo aberto por outra pessoa (lança erro em vez de forçar).
   2. `work/sheet-inspect/extract_products.py` (Python) — lê as planilhas já atualizadas →
      `public/dados-estoque.json` + `public/dados-insumos.json`. **Entregas programadas e
      fornecedor de Embalagens/MP (26/08/2026)**: pararam de vir de colunas fixas da planilha
      (Terceiros) e da aba "comprasareceber 2" (Embalagens/MP) — agora as duas vêm de
      `compras_a_receber.json` (Power Automate, mesma pasta sincronizada de
      `compras_produto.json`), casando por `produto_key == sku`. Em Terceiros o `loja_key`
      desse arquivo não corresponde ao nome do terceiro/coempacotador (é a unidade interna que
      fez a compra, não quem vai entregar) — por isso o casamento ali é só por `sku`; em
      Embalagens/MP o `loja` já é o código numérico, então usa `(loja_key, sku)`. A data usada é
      `data_agendamento` (mais confiável que a janela original quando o fornecedor atrasa), e só
      entram linhas com `qtd_unidades_pendentes > 0`. Cobertura de fornecedor ficou parecida com
      antes (~370/472 insumos sem fornecedor conhecido) — não é regressão, o arquivo só cobre
      pedidos em aberto.

      **Duas correções em 26/08/2026, pedidas pelo usuário ao ver o resultado real**:
      1. `qtd_unidades_pendentes` vem em unidade base (peça/pacote), não em caixa — mas
         Terceiros mostra tudo em `cx`. `multiplicador_caixa()` extrai o "CX 12"/"FD 24" da
         descrição do produto (mesmo regex `\b(?:CX|FD)\s*[-.]?\s*(\d{1,3})\b` do protótipo de
         Fornecedores) e divide a quantidade pendente por ele antes de virar `entregasProgramadas`
         — sem isso uma entrega de 840 caixas aparecia como "20.160 cx". Só se aplica a
         Terceiros; Embalagens/MP já usa `kg`/`unidade` direto, sem esse problema.
      2. Vários terceiros (ART FRITAS, APLAF, MALTA & REZENDE, COPRA, INDC, SEARA) tinham
         `produto_key` **diferente** do `sku` da planilha de Terceiros para o mesmo produto —
         a compra é registrada com um código "industrial" prefixado "INDL - " na descrição
         (ex.: produto_key `77761` "INDL - BATATA PALHA..." vs sku `75879` "BATATA PALHA..." na
         planilha). Nenhuma entrega desses terceiros aparecia. Fallback: quando o `produto_key`
         não casa, casa por descrição normalizada (maiúsculas, sem acento, sem prefixo "INDL - ",
         só alfanumérico) — recupera ~12 produtos que antes ficavam sem nenhuma entrega.

      **3º nível de casamento em 26/08/2026** (`melhor_match_fuzzy`): a descrição normalizada
      exata ainda falhava quando um lado abrevia palavra que o outro escreve por extenso (ex.:
      planilha "BATATA PALHA... TRADIC 100G" x compras_a_receber "...TRADICIONAL 100G" — 93%
      de similaridade, mas não é igual). Como último recurso, quando produto_key e descrição
      exata não casam: restringe candidatos ao mesmo fornecedor (nome da planilha contido no
      nome do compras_a_receber ou vice-versa, ex. "ART FRITAS" dentro de "ART FRITAS
      INDUSTRIA") e pega a descrição mais parecida por `difflib.SequenceMatcher`, só aceita
      se ≥ 85% (`LIMIAR_FUZZY`). Recuperou ART FRITAS de 3/12 pra 10/12, SEARA e INDC completos.
      APLAF e COPRA continuam sem nenhuma entrega — não é falha de casamento, esses dois
      fornecedores simplesmente **não aparecem** em nenhuma linha do `compras_a_receber.json`
      (confirmado buscando o nome no arquivo inteiro) — se isso for inesperado, o problema está
      na origem (Controladoria), não no painel.
   3. `work/sheet-inspect/apply_bi_terceiros.py` (Python, 20/08/2026) — sobrescreve
      Estoque/Saldo/Cobertura de Terceiros com `produtos_estoque.json` (BI/Power Automate, já
      sincronizado do SharePoint — não busca nada novo). Ver REGRAS_PAINEL_ESTOQUES.md.
   4. `work/sheet-inspect/extract_consumption_history.ps1` — consulta `movimento_estoque`
      **direto no Postgres via ODBC**, sem passar pelo Power BI → `consumo-mensal-odbc.csv`.
   5. `work/sheet-inspect/build_consumption_history.py` (Python) →
      `public/dados-consumo-insumos.json`.
2. **Escadinha** (`automation\atualizar_escadinha.ps1` → `extract_escadinha.py`): plano
   mestre + histórico de revisões + Real do mês em andamento vindo do BI de cortes.
3. **Estoque x Pedidos** (`automation\atualizar_pedidos_venda.ps1` →
   `extract_pedidos_venda_odbc.ps1`, lookup de categoria/escopo no Postgres, +
   `build_pedidos_venda.py`) → `public/dados-pedidos-venda.json`. Não busca nada novo — só
   reprocessa `produtos_estoque.json`/`dados_cortes.json`, que já chegam sozinhos via Power
   Automate.

Cada etapa dentro de cada pipeline é sequencial e para a pipeline inteira no primeiro erro (log
em `automation\logs\atualizacao-*.log` e `publicar-tudo-*.log`) — nunca deixa dados
parcialmente atualizados, seguindo a regra do REGRAS_PAINEL_ESTOQUES.md. As funções Python que
escrevem JSON usam escrita atômica (`*.tmp` + rename) pelo mesmo motivo. No fim, se
`git status` mostrar mudança em algum `public/*.json`, o script comita e dá push sozinho
(`git add`/`commit`/`push` sem `2>&1` de propósito — no PowerShell 5.1 redirecionar stderr de
um executável nativo pra dentro do pipeline derruba `$LASTEXITCODE` mesmo quando o comando deu
certo, e isso já causou um falso "FALHA ao publicar" com push que tinha ido certo).

## GitHub e hospedagem (11/08/2026)

Código publicado num repositório **privado** no GitHub, sob conta pessoal do usuário
(`745michel`), como caminho alternativo pra não esperar a decisão de hospedagem do TI —
decisão explícita do usuário de avançar assim por agora. `git`, `gh` (GitHub CLI) instalados
via winget nesta máquina; login feito via device flow (`gh auth login --web`), token com
escopo `repo`.

`origin` → `https://github.com/745michel/painel-estoques-da-terrinha` (main).
`sites` → remote antigo do Codex/ChatGPT Sites (`git.chatgpt-team.site/...`), preservado mas
não usado para esse fluxo novo.

**Histórico reescrito de propósito**: o `.git` herdado do Codex tinha 4 commits antigos
(`7f8f600` até `f68520b`) com versões reais de `data/dados-valores-insumos.json` (custo
contábil, valor de estoque reais). Publicar isso numa conta pessoal, fora do que o TI
administra, era um risco real — `git push` manda o histórico inteiro, não só o estado atual.
Solução: `git checkout --orphan clean-main` → um commit único, raiz, sem histórico anterior →
renomeado para `main` → `push --force`. O branch antigo (`main` local original, com o
histórico completo) não foi apagado, só não é mais o que aponta pro GitHub.

**`data/dados-valores-insumos.json` no repositório é um placeholder** (dados zerados/fake,
com 2 produtos de exemplo preservando a forma exata do tipo — 1 sozinho quebraria a inferência
de `string | null` em `descricaoBi`/`metodoRelacionamento`/`precoAtual` etc., usada em
`DashboardClient.tsx`). O arquivo real (1,1 MB, com valores de verdade) foi restaurado
localmente depois do commit e está marcado com `git update-index --skip-worktree` — o git
finge que esse arquivo não mudou, então nunca mais tenta comitar o conteúdo real por engano.
Se precisar reverter isso (por exemplo pra atualizar o placeholder de propósito):
`git update-index --no-skip-worktree data/dados-valores-insumos.json`.

**`data/dados-valores-produto-acabado.json` (21/08/2026) segue a mesma regra** — aba nova
"Valor produto acabado" (`app/lib/valor-produto-acabado.ts`), mesmo parâmetro do Valor dos
insumos (custo contábil × estoque, `valor_insumos.json` via Power Automate), só que cruzado
com `dados-pedidos-venda.json` (produto_key) em vez de `dados-insumos.json`. Também senha-
protegido na versão GitHub Pages (`valor-financeiro-produto-acabado.json`, mesmo hash de
`SENHA_HASH` em `github-pages-entry.tsx` — uma senha só destrava as duas abas financeiras).

**`data/dados-fornecedores.json` (26/08/2026) segue a mesma regra, com um pipeline diferente**
— aba nova "Fornecedores" (`FornecedoresDashboard` em `app/DashboardClient.tsx`): ranking de
fornecedores por valor pago e kg comprado, separado em dois grupos que nunca são somados
(`materia_prima` = Departamento "Compras" no relatório oficial, `produto_acabado` =
Departamento "Produto de venda"), com comparativo mensal 2025×2026 por fornecedor e gaveta de
detalhe (preço médio, variação de preço, notas fiscais, pedidos, produtos comprados). Fonte:
`compras_produto.json` (relatório "Compra por Produto", Power Automate, ~97 mil linhas, ~87 MB)
— **não segue o padrão do Valor produto acabado** (que cruza dados no navegador/CI a partir de
linhas brutas) porque o arquivo bruto é grande demais pra buscar do SharePoint a cada 30 min no
CI. Em vez disso, `work/sheet-inspect/build_fornecedores.py` já agrega tudo **localmente**
(nova pipeline `automation\atualizar_fornecedores.ps1`, parte de
`atualizar_e_publicar_tudo.ps1`) e copia só o resultado pequeno (~2 MB) para
`fornecedores_agregado.json` na pasta sincronizada do SharePoint — é só isso que
`scripts/ci-refresh-data.mts` busca (`work/valor-financeiro-fornecedores-ci.json`), nunca o
arquivo de 97 mil linhas. Mesma senha das outras duas abas financeiras
(`valor-financeiro-fornecedores.json`).

**Card de valor mensal (26/08/2026)**: `serieAnoMes` ganhou o campo `valor` (além de `kg`/
`caixas`) — pedido do usuário pra ver, ao escolher um fornecedor, o gráfico de Kg comprado
mês a mês **e** o de Valor pago mês a mês juntos (dois cards empilhados, mesma comparação de
anos), não só um com toggle. Selecionar um fornecedor na tabela/Top 10 sincroniza os dois
gráficos (`abrirGaveta` seta `tlFornecedor`). Layout geral (KPIs + gráficos + tabela) inspirado
num dashboard de referência que o usuário mandou, mas com a paleta de cores do próprio painel.

**Reajustes de layout (26/08/2026, mesmo dia)**: os dois cards de comparativo mensal eram
escuros (fundo roxo-marinho) — trocado pro padrão claro do resto do painel (mesma paleta de
`.value-kpi`/`.inventory-panel`) a pedido do usuário. KPIs (Total pago/Total comprado/
Fornecedores/Concentração top 3) subiram pro topo da página, logo abaixo do toggle de
departamento — antes ficavam depois dos dois gráficos. Novo filtro "focar fornecedor"
(`.forn-foco-filter`, campo de busca com datalist, fora dos cards de gráfico) — ao escolher
alguém ali, some o Top 10 e a tabela completa da tela, mostrando só os KPIs, os dois gráficos
mensais e a lista de produtos daquele fornecedor (`focoFornecedor`/`focarFornecedor`). Pedido
explícito: "vou chamar os fornecedores e mostrar o que fizemos de compra deles, não podemos
mostrar os outros" (uso em reunião/apresentação com o fornecedor específico). Clicar numa linha
da tabela/Top 10 continua só abrindo a gaveta lateral de detalhe (`selectedFornecedor`,
inalterado) — o filtro de foco é um controle separado, deliberado.

**Ranking por comprador (26/08/2026, mesmo dia)**: pedido do usuário — "quero saber o ranking
de fornecedores de cada comprador". `compras_produto.json` tem `comprador_nome` (37 compradores
distintos, 99,8% de cobertura). `build_fornecedores.py` ganhou `AcumuladorGrupo.comprador_acc` +
`montar_compradores()`: novo campo `compradores` em cada grupo (`listaCompradores` ordenada por
valor total + `porComprador[escopo][comprador]` com o ranking de fornecedores daquele comprador,
mesma forma de `anoData[ano].top`). Na UI, um `<select>` ao lado do filtro "focar fornecedor"
(mesma linha, `.forn-comprador-select`) troca `rankingContexto` inteiro (Top 10, tabela, KPIs)
pra mostrar só os fornecedores daquele comprador — reaproveita a mesma separação
Matéria-prima/Produto acabado e os mesmos anos de sempre. Selecionar um comprador limpa o foco
de fornecedor (e vice-versa) pra não misturar os dois modos de filtro.

**Ajustes finos do comprador (26/08/2026, mesmo dia)**: o campo "Focar num fornecedor
específico" listava todos os fornecedores do grupo, mesmo com um comprador selecionado —
confuso, porque a lista não tinha nada a ver com quem aquele comprador negocia. Agora
(`fornecedoresParaFoco`) o datalist filtra pros fornecedores do `porComprador[escopo]
[comprador].ranking` quando há comprador selecionado. Escolher um comprador também sincroniza
os dois gráficos mensais (Kg/Caixas e Valor) pro fornecedor #1 dele (`escolherComprador`) —
antes ficavam presos no último fornecedor visto, sem relação nenhuma com o comprador escolhido.
Os dois painéis ("Valor pago por ano" e "Volume por ano") viraram barra horizontal
(`.forn-yr-row`/`.forn-yr-bar-h`) em vez de vertical — pedido explícito do usuário pros dois,
depois de já ter pedido só pro de valor. Fonte dos números dos dois painéis subiu (7.5–9px →
9–12px), estava
ilegível. "Principais produtos" (drawer e a lista da visão de foco) ganhou preço médio por SKU
(`p.valor / p.kg`, só quando `kg > 0`) ao lado do valor e do kg já existentes — **revertido no
mesmo dia**, ver nota mais abaixo.

**2024 removido da aba Fornecedores (26/08/2026, mesmo dia)**: pedido explícito — "tira a
informação de 2024 mantém 2025 e 2026". Corrigido na fonte: `ANO_MINIMO` em
`build_fornecedores.py` subiu de "2020" pra "2025", então 2024 nunca entra em nenhuma estrutura
(`anoData`, `listaFornecedores`, `serieAnoMes`, `produtos`, `metricas`, `compradores` — inclusive
o escopo "todos", que soma todos os anos reais). Corrigir só no front (filtrar `anos` na hora de
montar a legenda/comparativo) teria deixado os agregados "todos" da gaveta e do ranking por
comprador ainda contaminados com 2024, já que esses vêm prontos do JSON. `DashboardClient.tsx`
também ganhou uma segunda camada de segurança (`FORN_ANOS_OCULTOS`, filtra `anos` de qualquer
jeito) — redundante depois do fix na fonte, mas barata e evita reaparecer se algum dia rodar
com um `data/dados-fornecedores.json` gerado antes dessa mudança.

**Top 10 vira "Principais produtos" no filtro de comprador; caixa em vez de kg; sem preço/kg
(26/08/2026, mesmo dia)**: o gráfico Top 10 (barras de fornecedor) repetia a mesma informação já
mostrada na tabela logo abaixo quando um comprador estava filtrado — pedido do usuário pra
trocar por produtos ali. `produto_comprador_acc` (novo, agregado dentro
de `montar_compradores`) agrega produtos comprados por aquele comprador **através de todos os
fornecedores dele**, e `porComprador[escopo][comprador].produtos` (top 6, mesma forma de
`produtos[escopo][fornecedor]`) substitui o gráfico só quando `compradorFiltro` está ativo — a
tabela de fornecedores continua igual embaixo. `produto_acc` (e o novo `produto_comprador_acc`)
ganharam `caixas` (mesmo cálculo de `serie_mes`, via `multiplicador_caixa`/
`eh_caixa_como_unidade`) — pedido explícito: "o que for caixa coloca caixa não kg". A função
`qtdProduto()` no front decide: caixas > 0 → mostra caixas, senão kg. O preço médio por SKU
adicionado horas antes foi removido dos três lugares que mostram produto (drawer, foco,
comprador) — pedido explícito "não quero valor por kg".

**Comprador filtrado pra 5 nomes (26/08/2026, mesmo dia)**: pedido explícito — "quero que
mantenha esses compradores... o restante tira". `COMPRADORES_PERMITIDOS` em
`build_fornecedores.py` (nomes completos, batidos contra `comprador_nome` real do
`compras_produto.json` — o usuário deu versões abreviadas: "MARTA JESUS"→"MARTA DE JESUS",
"VICTOR FELIPE"→"VITOR FELIPE", "DILMA TEODORA"→"DILMA TEODORA DA SILVA", "GISELA SANTOS"→
"GISELLA SANTOS", "HAMILTON ALVES"→"HAMILTON ALVES DE JESUS BATISTA") filtra `montar_compradores`
inteiro — `listaCompradores` e `porComprador` só trazem esses 5 (ou menos, se algum não tiver
compra num grupo/ano — ex.: Hamilton não aparece em produto_acabado). Se um novo comprador
precisar entrar, é só adicionar o nome exato (como aparece em `comprador_nome`) nesse set.

**Top 10 removido, caixa em todo lugar de fornecedor (26/08/2026, mesmo dia)**: pedido
explícito — "segunda imagem não quero essa visão pois é repetida" (o gráfico Top 10 padrão,
sem comprador filtrado, também repetia a tabela logo abaixo — não só o caso do comprador) e
"esses fornecedores não pode aparecer kg tem que ser caixa" (ART FRITAS, APLAF, DICOCO etc. —
os mesmos terceiros/coempacotadores que só fazem sentido em caixa). Duas mudanças:
1. O gráfico Top 10 (barras de valor+kg por fornecedor) foi removido de vez — nos dois modos,
   com ou sem comprador filtrado. Com comprador filtrado continua mostrando "Principais
   produtos" (ver nota acima); sem comprador filtrado, vai direto pro cabeçalho da tabela.
   CSS morto do gráfico (`forn-rank-*`) removido.
2. `caixas` agora existe em **todo** nível de fornecedor, não só produto:
   `por_ano_fornecedor` (usado em `anoData[ano].top`), `metrica_acc` (usado em `metricas`,
   inclusive a gaveta) e `comprador_acc` (usado no ranking por comprador) — mesmo cálculo de
   `serie_mes`/`produto_acc`. `qtdCaixaOuKg()` no front (renomeada de `qtdProduto`, mesma
   função reaproveitada pra produto E fornecedor) decide caixa vs kg em todo lugar que mostra
   quantidade de fornecedor: coluna da tabela (agora "Kg/Caixa comprado"), KPI da visão de
   foco, e o stat da gaveta lateral.

**Foco multi-fornecedor + tabela de produtos por ano (27/08/2026)**: dois pedidos do usuário.
1. "Gostaria de filtrar mais de um fornecedor" — o filtro "Focar num fornecedor específico"
   (antes um `<input>` com datalist, um valor só) virou `focoFornecedores: string[]`,
   usando o mesmo componente `MultiFilter` (checkbox + busca) já usado em Terceiros/Insumos —
   consistência de UI, sem inventar componente novo. Com N fornecedores selecionados: KPIs
   somam valor/kg/caixas dos N (`metricaFocoCombinada` — preço médio recalculado do zero por
   `valorTotal/kgTotal`, corretamente ponderado; variação de preço só existe com exatamente 1
   selecionado, com N>1 mostra "vários"), a tabela principal fica restrita a esses N
   fornecedores (mesmo mecanismo do filtro de comprador — filtra `rankingContexto.lista` por
   nome), e aparece uma seção "Principais produtos" **por fornecedor** (não uma lista
   combinada — evita ambiguidade se dois fornecedores tiverem produto de nome parecido).
2. "Quando clicar no fornecedor mostra tudo que ele comprou aqui, com números de 2025 e 2026,
   com coluna de valor e kg ou caixa" — a lista simples de produtos (`.product-row`, só um
   ano por vez, olhando `escopoGaveta`) virou tabela de verdade (`produtosPorAno()` +
   `renderTabelaProdutos()`): uma linha por produto, colunas Valor e Kg/Caixa **para cada ano**
   (2025 e 2026 lado a lado), ordenada pelo valor total somado dos dois anos. Casa produto por
   nome entre os dois anos — se um produto só foi top 6 num dos anos, o outro ano fica "—"
   nessa linha (aproximação aceitável pra uma visão de "principais produtos", não uma lista
   exaustiva). Usada na visão de foco (por fornecedor) e no "Principais produtos" do comprador
   filtrado; a gaveta lateral (`selectedFornecedor`, mais estreita) manteve a lista simples de
   antes — uma tabela de 5 colunas não cabe bem em 440px.

**Dois bugs corrigidos, mesmo dia (27/08/2026)**:
1. Escolher um fornecedor no filtro "Focar fornecedores" enquanto um comprador estava
   filtrado limpava o comprador (`mudarFocoFornecedores` chamava `setCompradorFiltro("")`)
   — pedido explícito pra não acontecer: "quando eu clico no comprador e escolho o
   fornecedor, o comprador some, não pode acontecer". `rankingContexto` já filtrava os dois
   em conjunto corretamente (comprador restringe a lista, foco filtra ainda mais) — só a
   limpeza indevida do estado foi removida. Cabeçalhos (KPI e "Principais produtos") agora
   mostram o comprador ativo também quando um fornecedor específico dele está focado.
2. Produtos com nome quase igual entre notas (abreviação inconsistente na origem — ex.:
   "BATATA PALHA DT TRADICIONAL" x "BATATA PALHA DA TERRINHA TRADICIONAL", "DT" = "DA
   TERRINHA") apareciam como duas linhas separadas em "Principais produtos", cada uma com
   valor/kg parciais. `normalizar_produto_chave()` (novo, `build_fornecedores.py`) expande
   `\bDT\b` → "DA TERRINHA" só pra fins de **agrupamento** (`AcumuladorGrupo.chave_produto`) —
   o nome exibido continua o original, escolhendo a variante mais completa (mais caracteres)
   entre as que apareceram (`nomes_canonicos`). Validado: ART FRITAS INDUSTRIA 2026 —
   "BATATA PALHA DA TERRINHA TRADICIONAL 100G - CX20" foi de duas linhas (R$3.174.273 +
   R$501.316) pra uma só (R$3.675.589), soma batendo exato.

**Card de histórico mensal por produto + busca (27/08/2026)**: pedido do usuário — clicar num
produto em "Principais produtos" agora abre um card (mesmo padrão visual da gaveta lateral,
`.forn-produto-drawer`, mais largo — 680px) com uma tabela mês a mês (jan-dez) comparando os
dois anos reais lado a lado: valor e Kg/Caixa de cada ano, mais "% comparação" (variação do
valor do ano mais recente contra o mesmo mês do ano anterior — mesma convenção de cor de
`variacaoPrecoPct`, subida em vermelho). Fonte: `produto_mes_acc`/`produto_comprador_mes_acc`
(novo em `build_fornecedores.py`, mesma ideia de `serie_mes` só que também guardando o produto,
não só o fornecedor) — anexado como `serieAnoMes` em cada linha de produto (só nos escopos de
ano real, não em "todos", pra não duplicar à toa). Tamanho do arquivo subiu de ~2,5 MB pra
~3,5 MB — ainda ok pra baixar uma vez só ao abrir a aba.

**Sem limite de 6 produtos + busca no topo (27/08/2026, mesmo dia)**: pedido do usuário —
"tudo que eu compre do fornecedor selecionado". `TOP_PRODUTOS` em `build_fornecedores.py`
virou `None` (sem corte) — "Principais produtos" mostra todos os itens comprados daquele
fornecedor/comprador, não só os 6 mais caros (fornecedor com mais SKUs distintos chegou a 120
produtos; a maioria fica bem abaixo disso, média de ~3). Arquivo subiu de ~3,5 MB pra ~6 MB —
ainda razoável pra um download único. O campo de busca (antes duplicado dentro de cada tabela
de "Principais produtos") subiu pro topo da página, na mesma linha dos outros filtros
(`.forn-foco-filter`, ao lado de "Focar fornecedores" e do `<select>` de comprador) — um só
campo, filtra qualquer tabela de produtos que estiver visível na tela.

**Linha de total no card de histórico mensal (27/08/2026, mesmo dia)**: `<tfoot>` soma os 12
meses de cada ano (valor, kg, caixas — separado, não junto) e recalcula a % comparação em cima
dos totais anuais (não é média das % mensais, é `(totalB−totalA)/totalA`, correto pra
agregado). Linha destacada com fundo levemente cinza e borda superior mais grossa
(`.forn-produto-mes-total`).

**Empresas do grupo ocultas por padrão (27/08/2026, mesmo dia)**: 2JM Amidos e Terrafec
(Fécula Mandioca e Primavera) são empresas do próprio grupo Da Terrinha, não fornecedores
externos de verdade — distorciam o ranking/KPIs. Investigado primeiro se o campo `Intercompany`
do `compras_produto.json` resolvia isso de forma genérica: não resolve, vem "Sim" pra ~2.140
fornecedores completamente externos também (parece ser flag por nota fiscal, não por
fornecedor) — inútil pra esse filtro. `FORN_GRUPO_INTERNO` (novo, `DashboardClient.tsx`, só
3 nomes exatos: "2JM AMIDOS", "TERRAFEC FECULA MANDIOCA", "TERRAFEC PRIMAVERA") filtra o
`rankingContexto` por padrão. Checkbox "Incluir empresas do grupo" (`.forn-grupo-interno-toggle`,
mesma linha dos outros filtros) reverte isso quando marcado. Continuam escolhíveis no filtro
"Focar fornecedores" independente do checkbox — selecionar um deles ali pula a exclusão (senão
a lista ficaria vazia depois de filtrar pelo nome escolhido).

**Custo unitário em "Principais produtos" (27/08/2026, mesmo dia)**: `custoUnitario()` (novo,
igual `qtdCaixaOuKg()` na lógica de escolher caixa vs kg — `valor / caixas` quando tem caixa,
senão `valor / kg`) — diferente do "valor por kg" que foi removido antes por pedido explícito
("não quero valor por kg"), esse divide pela unidade certa em vez de sempre kg. Só na tabela
"Principais produtos" (mais uma coluna por ano, cabe bem — tabela é full-width). Não adicionado
no card de histórico mensal (`.forn-produto-mes-tabela`) de propósito — já tinha tido problema
de coluna sobrando ali antes, e dá pra calcular de cabeça a partir de Valor/Kg-Caixa que já tem.

**Preço da última NF (27/08/2026, mesmo dia)**: pedido do usuário — quer o preço unitário só
da nota fiscal mais recente, separado do custo médio ponderado do período. `ultima_nf_fornecedor`/
`ultima_nf_comprador` (novo, `build_fornecedores.py`) guarda, por fornecedor/comprador +
produto, a linha com `data_emissao` mais recente (comparação de string ISO, funciona porque o
formato já vem `AAAA-MM-DD...`) — **não** usa o campo `custo_liq_unit` da fonte porque ele é
sempre por kg/unidade base, mesmo pra produto de caixa (confirmado: `custo_liq_unit ==
Custo_liquido_total/volume_kgs` em toda amostra testada) — inconsistente com a coluna de custo
unitário já existente, que às vezes é por caixa. Em vez disso guarda valor/kg/caixas da própria
linha e reaproveita `custoUnitario()` no front, garantindo a mesma unidade das outras colunas.
Nova coluna "Preço última NF" na tabela "Principais produtos" (não no card mensal, mesmo motivo
do custo unitário — já apertado).

`exports/*.html` (snapshots offline antigos do Codex, com dados financeiros reais embutidos)
e `.env*` nunca são comitados — ambos no `.gitignore`.

### Publicação real: GitHub Pages (11/08/2026), não Cloudflare

O usuário pediu explicitamente para não usar Cloudflare — publicação é via **GitHub
Pages + GitHub Actions**, 100% dentro do GitHub. Site ao vivo:
**https://745michel.github.io/painel-estoques-da-terrinha/**

Repositório teve que ficar **público** — GitHub Pages não funciona em repo privado no plano
gratuito (`gh api .../pages` retorna 422 "Your current plan does not support GitHub Pages").
Decisão explícita do usuário, sabendo que código e `REGRAS_PAINEL_ESTOQUES.md`/`CLAUDE.md`
ficam visíveis a qualquer um.

Essa versão **não usa `app/page.tsx`/`auth.ts`/`proxy.ts`** (esses continuam existindo para uma
eventual hospedagem com servidor de verdade). É um site estático separado, gerado por:

- `scripts/ci-refresh-data.mts` — roda dentro do Action, busca os 4 datasets do SharePoint
  (reaproveita `app/lib/sharepoint.ts` + `valor-insumos.ts`), grava `public/dados-*.json` e
  `work/valor-financeiro-ci.json` (financeiro, fica fora do bundle).
- `scripts/build-github-pages.mjs` — empacota `scripts/github-pages-entry.tsx` com esbuild
  (mesmo mecanismo de `work/build-offline-exact.mjs`, que já existia no projeto) num HTML
  autocontido em `gh-pages-dist/`. O financeiro vai como arquivo separado
  (`valor-financeiro.json`) ao lado do HTML.
- `scripts/github-pages-entry.tsx` — UI operacional sempre visível; aba financeira só
  aparece depois de uma senha (hash SHA-256 embutido no bundle, comparado no navegador antes
  de buscar `valor-financeiro.json`). **Decisão explícita e informada do usuário**: isso não é
  segurança real — o arquivo financeiro fica numa URL pública e previsível, buscável direto
  por quem souber/inspecionar a rede. Senha atual: `X9363skCdpDa` (mesmo valor da barreira
  HTTP local em `proxy.ts`, hash em `SENHA_HASH` dentro de `github-pages-entry.tsx`).
- `.github/workflows/deploy-pages.yml` — roda a cada 30 min + a cada push em `main` + manual
  (`gh workflow run deploy-pages.yml`). Segredos do SharePoint em Settings → Secrets → Actions
  do repositório (`SHAREPOINT_TENANT_ID`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_SITE_HOSTNAME`,
  `_SITE_PATH`, `_FOLDER_PATH`) — os mesmos valores do `.env.local`. `continue-on-error: true`
  na busca do SharePoint: se falhar, o deploy segue com os dados já commitados/placeholder em
  vez de quebrar o site inteiro.

**Scripts em `scripts/` (não `work/`) de propósito**: `work/` é todo `.gitignore`, e o Action
faz `checkout` limpo — precisava que esses 3 arquivos fossem versionados.

### Tentativa de login via Firebase — pausada (11/08/2026)

Usuário pediu autenticação real (usuários de verdade) para a versão GitHub Pages, já que ela
não tem servidor para o login Microsoft/Entra ID (esse continua pendente da URL de
redirecionamento do TI, ver acima). Firebase parecia ideal: Auth roda 100% client-side, e
Realtime Database com Security Rules dá proteção de servidor de verdade pro financeiro (bem
melhor que o hash SHA-256 atual).

**Progresso feito, tudo inerte/não conectado ao site ainda**:
- Projeto `painel-estoques-terrinha` criado (conta Google `suporte@daterrinhaalimentos.com.br`,
  login via `firebase login` device flow).
- App web registrado (config em `scripts/local-manage-user.mjs` e no histórico da sessão).
- Realtime Database criado (`painel-estoques-terrinha-default-rtdb`, região padrão) e regras
  publicadas (`database.rules.json` — `usuarios/{uid}` só o próprio uid lê;
  `valoresInsumos` só lê quem tiver `usuarios/{uid}/acessoValores == true`).
- Chave de service account gerada e salva em `work/firebase-service-account.json`
  (gitignored) + segredo `FIREBASE_SERVICE_ACCOUNT_KEY` no GitHub Actions (não usado ainda).
- `firebase`/`firebase-admin` instalados em `package.json`.

**Bloqueio real, não contornado**: criar um usuário (via Admin SDK, via API pública
`accounts:signUp`, e a tentativa do usuário direto no Console) sempre retornou
`CONFIGURATION_NOT_FOUND`. Causa raiz encontrada via
`identitytoolkit.googleapis.com/v2/.../identityPlatform:initializeAuth`:
**`BILLING_NOT_ENABLED — Identity Platform feature requires billing to be enabled`**. Ou seja,
login por e-mail/senha do Firebase **também** exige cartão vinculado ao projeto Google Cloud —
a mesma exigência do Firestore que a troca para Realtime Database tentou evitar, só que essa
não tem alternativa sem cartão.

**Decisão do usuário**: não vincular cartão agora. Pausar Firebase e esperar o login Microsoft
via IT (`REQUIRE_LOGIN=true` em `app/page.tsx`, pendente só da URL de redirecionamento no App
Registration). `scripts/github-pages-entry.tsx` continua com a senha SHA-256 de antes — nada
foi trocado, o site ao vivo não mudou.

Se retomar isso depois: o próximo passo seria vincular billing (gratuito dentro da cota,
cartão é só cadastro) e então criar o primeiro usuário com
`node scripts/local-manage-user.mjs email senha true|false`.

**Falha silenciosa em 06/08/2026 08:30**: a execução agendada não disparou (nenhum log, nenhum
registro de tentativa — `Get-ScheduledTaskInfo` continuou mostrando a execução anterior como a
"última"). Causa: a máquina é um notebook e a tarefa foi criada com a config padrão do Windows
"Não iniciar se estiver usando bateria" (`New-ScheduledTaskSettingsSet` sem
`-AllowStartIfOnBatteries`/`-DontStopIfGoingOnBatteries`). Se a máquina estiver na bateria no
horário do gatilho, a tarefa é silenciosamente ignorada — sem log, sem erro. Corrigido
recriando a tarefa com esses dois parâmetros. Se a atualização voltar a "não acontecer" sem
nenhum log em `automation\logs`, suspeite primeiro de energia/bateria ou de sessão do Windows
não estar logada (`LogonType Interactive` exige sessão ativa do usuário no horário exato).

**Tarefa morta pelo limite de execução em 26/08/2026 14:00**: a rodada das 14:00 rodou até o
fim (as 4 pipelines terminaram, inclusive Fornecedores) mas nunca comitou/publicou. Causa:
`ExecutionTimeLimit` da tarefa estava em 20 min (`PT20M`, herdado de quando só existiam as 3
pipelines mais leves) — com Fornecedores (lê `compras_produto.json`, ~87 MB) a rotina passou a
levar ~20–25 min, e o Windows mata a tarefa (`LastTaskResult 267014` = terminada) bem no fim,
antes do passo de `git add`/`commit`/`push`. `Get-ScheduledTaskInfo` mostra "terminada", não
"falhou" — não aparece como erro óbvio no log (o log só para de crescer no meio). Corrigido
subindo o limite pra 1h (`Set-ScheduledTask -Settings` com `ExecutionTimeLimit = "PT1H"`). Se a
publicação automática voltar a "sumir" sem erro no log, com o log parando no meio de uma
pipeline, suspeite deste limite antes de mais nada.

**Validado de ponta a ponta em 05/08/2026** (execução limpa, sem Excel aberto antes): Terceiros
138s + Embalagens 245s + extração das planilhas 26s + consumo ODBC 14s + JSON de consumo <1s ≈
7min. A query M `movimento_estoque` da planilha de Embalagens foi reescrita pelo usuário para
`Odbc.Query` com SQL nativo (`WHERE`/`GROUP BY` no Postgres) — a versão anterior usava
`Table.SelectRows` client-side sobre a tabela inteira via `Odbc.DataSource`, sem query folding,
e por isso variava entre ~2min e >12min (timeout).

**Falha real na primeira execução agendada (15:00, 05/08/2026)**: Embalagens falhou depois de
salvar com sucesso — `Workbook.Close()` não confirmou em 10 tentativas (COM travado por
contenção, não por dado incorreto). O log só mostrava "código 1" sem a mensagem real porque as
chamadas aninhadas em `atualizar_dados.ps1` não capturavam `stderr` — corrigido (`2>&1` +
mensagem completa no throw). Duas correções aplicadas:
1. `refresh_workbooks.ps1`: falha em `Close()` depois do `Save()` já ter funcionado agora só gera
   `Write-Warning`, não interrompe a rotina — o dado já está salvo, é só limpeza de COM.
2. `atualizar_dados.ps1`: antes de começar, mata instâncias invisíveis sobradas do Excel (sem
   título de janela) e aborta rápido com mensagem clara se houver uma janela **real** aberta —
   em vez de descobrir isso só depois de minutos travado em `Workbooks.Open`.

Se travar de novo, a causa mais provável ainda é outra janela do Excel aberta na máquina —
mas agora sobras invisíveis se limpam sozinhas, e o log mostra a mensagem de erro real.

**Fora deste programa, de propósito:**
- **Valor dos insumos** — meu atalho testado (consulta direta a `ficha_custo`/`ficha_estoque`)
  bate exato nos 2 valores de controle do documento, mas errou por ~4% (R$1,3M) no total
  agregado contra o snapshot completo do Power BI (`work/sheet-inspect/bi-estoque-sem-filtros-*.json`,
  7.288 linhas). O relatório publicado no workspace tem lógica de negócio (DAX) que as tabelas
  brutas não reproduzem — **não usar esse atalho para essa aba**. Fica para uma extração via
  Power Automate/DAX (planejada, ainda não implementada).
- **Publicação** — sem credencial Cloudflare própria neste projeto; só existe via ChatGPT/Codex.

`python` foi instalado em `%LOCALAPPDATA%\Programs\Python\Python312\python.exe` (05/08/2026,
via winget) com `openpyxl`. Esse caminho é hardcoded em `automation\atualizar_dados.ps1` — se o
Python for reinstalado em outro local, ajuste o script.

### Busca de dados em tempo de execução (05/08/2026)

O painel deixou de depender de JSON estático "gravado" no build. `app/page.tsx` busca os 4
datasets via Microsoft Graph API direto do SharePoint (site `DT-BI`, biblioteca
`Documentos/pcp/extracao_dados_planejamento_estoque`) a cada requisição (`dynamic =
"force-dynamic"`), com fallback automático para o JSON estático do build se o Graph não
estiver configurado ou a busca falhar — o painel nunca cai por causa disso, só mostra dados
potencialmente antigos.

- `app/lib/sharepoint.ts` — cliente Graph (client-credentials/app-only). Requer as env vars
  `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`,
  `SHAREPOINT_SITE_HOSTNAME`, `SHAREPOINT_SITE_PATH`, `SHAREPOINT_FOLDER_PATH` — já configuradas
  em `.env.local` (não versionado) e **validadas de ponta a ponta em 07/08/2026** com o dev
  server real (as 4 buscas via Graph + a transformação de valores funcionaram sem cair no
  fallback estático).

  App Registration: "App PCP e Compras" (client ID `07548f43-35db-4da8-bb71-463339e1793e`,
  tenant `ed1c5836-e579-4f4d-be52-e0f3a971457a`), com permissão de aplicativo `Sites.Selected`
  (Microsoft Graph) + consentimento de admin, e concessão de acesso `read` por site nos dois
  sites (`DT-PCP` e `DT-BI`).

  **Pegadinha real que consumiu bastante troubleshooting, documentada para não repetir**:
  `Sites.Selected` tem uma versão **Delegada** e uma versão **Aplicativo** — são permissões
  distintas na mesma tela do Portal Azure, fácil de adicionar a errada. Client-credentials
  (app-only, sem usuário logado) só funciona com a versão **Aplicativo**. Se o token decodificado
  não tiver `roles: ["Sites.Selected"]`, é sinal de que só a Delegada foi consentida. A concessão
  de acesso por site (`POST /sites/{id}/permissions` ou `Grant-PnPAzureADAppSitePermission`) é um
  segundo passo **separado e adicional** — precisa dos dois para funcionar, e precisa repetir a
  concessão por site para cada site novo (não é automático por causa do consentimento no app).
- `app/lib/store-names.ts` — mapa loja↔nome compartilhado (painel usa chave numérica; Power
  BI/Power Automate usa nome completo).
- `app/lib/valor-insumos.ts` — porta para TS de `work/sheet-inspect/build_bi_store_values.py`,
  adaptada para consumir `valor_insumos.json` (Power Automate) em vez do snapshot manual do
  Power BI. Validado 05/08/2026: mesma ordem de grandeza do pipeline Python, pontos de
  controle batendo por produto.
  **Nota de schema instável**: em 05/08/2026 o campo `descricao` desse JSON passou a vir como
  número e o texto do produto passou a vir em `produto_key` (nomes parecem trocados no fluxo
  do Power Automate). O código já lida com os dois formatos (`descricaoTexto()` em
  `valor-insumos.ts`), mas se puder corrigir o nome dos campos no fluxo, `descricao` deveria
  voltar a ser o texto.
- `dados-estoque.json`, `dados-insumos.json`, `dados-consumo-insumos.json` são buscados
  **prontos** (sem transformação) — já vêm corretos do pipeline local
  (`automation/atualizar_dados.ps1`), que agora também copia os 3 para a mesma pasta do
  SharePoint como última etapa.

**Por que `consumo_insumos.json` (bruto, do Power Automate) não é usado**: mesmo depois de
corrigir a correspondência de produto (usar `produto_key` numérico em vez de nome/descrição,
que foi de 66% para 80% de linhas casadas), os valores de quantidade não reconciliam com o
pipeline ODBC confiável — testado no SKU 8067 (BOBINA TAPIOCA DA TERRINHA 1 KG), o Power
Automate deu ~452 kg/mês contra ~13.286 kg/mês do pipeline confiável, uma diferença de ~29x,
não um erro de correspondência. Provavelmente unidade/escala diferente no modelo "movimento
estoque producao" do Power BI. Até isso ser investigado e corrigido na fonte, a seção
"Consumo de insumos" continua usando o JSON já calculado localmente.

### Controle de acesso

**Substituído em 07/08/2026.** O painel deixou de depender do header
`oai-authenticated-user-email` (só existe na plataforma Sites do ChatGPT) e passou a exigir
**login real com conta Microsoft da empresa** (Entra ID, via Auth.js/`next-auth@5`). Login e
autorização são checagens separadas de propósito:

1. **Login** (`auth.ts`, provider `microsoft-entra-id`) só prova identidade — qualquer conta do
   tenant `daterrinhaalimentos.com.br` consegue logar. Sessão em JWT, sem banco.
2. **Autorização** (`resolveAccess()` em `app/page.tsx`) decide o que essa pessoa pode ver,
   consultando a lista **`AcessoPainelEstoques`** no SharePoint (site DT-BI) via
   `app/lib/sharepoint.ts#fetchAccessList()` — colunas `Email`, `Nome`, `AcessoValores`
   (Sim/Não), `Ativo` (Sim/Não). Uma linha por pessoa autorizada. **Você mesmo gerencia essa
   lista direto no SharePoint** — não existe tela de admin dentro do painel, de propósito
   (ver conversa 07/08/2026: decisão explícita de não construir isso).
   - Logado mas sem linha na lista (ou `Ativo=Não`) → tela "Acesso não liberado" com botão de
     sair, não vê o painel.
   - Se o SharePoint estiver fora do ar e a lista não puder ser lida, **não bloqueia todo
     mundo por uma falha de infra**: deixa entrar na parte operacional e nega só a financeira
     (`resolveAccess` trata esse caso separado de "não autorizado").
   - `AcessoValores=Sim` libera a seção "Valor dos insumos"; todo o resto do painel
     (terceiros, embalagens/MP, consumo) é visível para qualquer linha `Ativo=Sim` na lista.

**Pendente do TI**: adicionar a URL de redirecionamento no App Registration "App PCP e
Compras" (Authentication → Add a platform → Web) — precisa de uma entrada por ambiente onde
o painel roda:
- Local/dev: `http://localhost:3000/api/auth/callback/microsoft-entra-id`
- Produção: `https://<dominio-final>/api/auth/callback/microsoft-entra-id` (adicionar quando
  o TI decidir a hospedagem)

O mesmo App Registration já é usado para o Graph app-only (leitura do SharePoint) — reaproveita
client ID/secret, só adiciona esse uso novo (login delegado). `AUTH_SECRET` em `.env.local` é
só para assinar o cookie de sessão local; gerar um novo por ambiente de produção.

Validado localmente em 07/08/2026: `/` sem sessão redireciona (307) para `/login`, que
renderiza corretamente. O clique real em "Entrar com Microsoft" e o retorno do callback não
foram testados de ponta a ponta (exige navegador + MFA de uma conta real) — validar isso é o
próximo passo, depois que o TI cadastrar a URL de redirecionamento.

## Migração do Codex → Claude Code (04/08/2026)

Copiado de `Documents\Codex\2026-07-17\sites-plugin-sites-openai-bundled-criar`. A pasta antiga
continua lá intacta; esta é a cópia de trabalho.

Ficou de fora de propósito: `node_modules`, `.pnpm-store`, `dist`, `.vinext`, `.wrangler`, os
~70 diretórios de staging `site-package-*` / `site-stage-*` / `sites-package-*` em `work/`
(≈350 MB de cópias de publicação descartáveis) e os `.tar.gz` de release. `work/sheet-inspect/`
e `work/embalagem-base.xlsm` foram mantidos porque são ETL e base real. `build/` foi mantido —
apesar do nome, é código-fonte (`sites-vite-plugin.ts`), não artefato.

Uma mudança de código foi necessária: os scripts `dev`/`build`/`start` do `package.json` usavam
o prefixo bash `WRANGLER_LOG_PATH=... vinext ...`, inválido no Windows. O prefixo era redundante
— `vite.config.ts` já faz `process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs"` — então foi
removido.

**`git` não está instalado nesta máquina.** O diretório `.git` veio junto (histórico do Codex,
4 MB) mas nenhum comando git roda até o Git for Windows ser instalado.

## Publicação

Preservar o `project_id` de `.openai/hosting.json`
(`appgprj_6a5a81e438ac8191b41da145c9916380`) e o mesmo endereço. Compilar, validar produtos,
lojas, unidades, entregas, custos e totais, e publicar como nova versão **privada** mantendo o
link. Detalhes em REGRAS_PAINEL_ESTOQUES.md.
