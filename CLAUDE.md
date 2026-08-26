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
      `public/dados-estoque.json` + `public/dados-insumos.json`.
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
