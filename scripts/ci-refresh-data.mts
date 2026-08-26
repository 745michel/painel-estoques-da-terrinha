// Roda dentro do GitHub Actions (secrets protegidos la, nunca expostos ao navegador).
// Busca os datasets do SharePoint e grava:
//   - public/dados-estoque.json, dados-insumos.json, dados-consumo-insumos.json,
//     dados-mrp-terceiros.json, dados-escadinha.json
//     (operacional - embutido no bundle estatico pelo build-github-pages.mjs)
//   - work/valor-financeiro-ci.json (financeiro - fica FORA do bundle, copiado como
//     arquivo separado por build-github-pages.mjs, so buscado depois da senha no navegador)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSharePointJson } from "../app/lib/sharepoint";
import { buildValorInsumos, type ValorInsumosRow } from "../app/lib/valor-insumos";
import { buildValorProdutoAcabado } from "../app/lib/valor-produto-acabado";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await fs.mkdir(path.join(root, "work"), { recursive: true });

const estoqueData = await fetchSharePointJson("dados-estoque.json");
const insumosData = await fetchSharePointJson<{ produtos: unknown[] }>("dados-insumos.json");
const consumoData = await fetchSharePointJson("dados-consumo-insumos.json");
const mrpTerceirosData = await fetchSharePointJson("dados-mrp-terceiros.json");
const escadinhaData = await fetchSharePointJson("dados-escadinha.json");

// O fluxo do Power Automate que gera valor_insumos.json roda no horario dele, independente
// deste workflow (que dispara a cada 30 min). Se o cron cair no meio da janela em que o
// Power Automate ainda esta regravando o arquivo do dia, buscamos uma versao "presa" no dia
// anterior ao anterior (D-2 ou mais velha) - da pra recuperar so esperando um pouco e tentando
// de novo. Ver CLAUDE.md / conversa 12/08/2026.
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 120_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saoPauloToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

let rawValor: ValorInsumosRow[] = [];
let valoresData = buildValorInsumos(insumosData as never, []);
const ontem = addDays(saoPauloToday(), -1);

for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
  rawValor = await fetchSharePointJson<ValorInsumosRow[]>("valor_insumos.json");
  valoresData = buildValorInsumos(insumosData as never, rawValor);
  const referencia = valoresData.dataReferencia?.slice(0, 10) ?? null;
  const aceitavel = referencia != null && referencia >= ontem;
  if (aceitavel) break;
  const ultimaTentativa = attempt === RETRY_ATTEMPTS;
  console.warn(
    `valor_insumos.json desatualizado (dataReferencia=${referencia ?? "nenhuma"}, esperado >= ${ontem}), tentativa ${attempt}/${RETRY_ATTEMPTS}` +
      (ultimaTentativa ? " - publicando mesmo assim." : ` - aguardando ${RETRY_DELAY_MS / 1000}s para tentar de novo.`),
  );
  if (!ultimaTentativa) await sleep(RETRY_DELAY_MS);
}

await fs.writeFile(path.join(root, "public", "dados-estoque.json"), JSON.stringify(estoqueData, null, 2), "utf8");
await fs.writeFile(path.join(root, "public", "dados-insumos.json"), JSON.stringify(insumosData, null, 2), "utf8");
await fs.writeFile(path.join(root, "public", "dados-consumo-insumos.json"), JSON.stringify(consumoData, null, 2), "utf8");
await fs.writeFile(path.join(root, "public", "dados-mrp-terceiros.json"), JSON.stringify(mrpTerceirosData, null, 2), "utf8");
await fs.writeFile(path.join(root, "public", "dados-escadinha.json"), JSON.stringify(escadinhaData, null, 2), "utf8");
await fs.writeFile(path.join(root, "work", "valor-financeiro-ci.json"), JSON.stringify(valoresData, null, 2), "utf8");

// dados-pedidos-venda.json nao vem do SharePoint (precisa do Postgres, so gerado localmente e
// comitado direto) - le a versao ja no checkout pra cruzar com valor_insumos.json. Ver
// app/lib/valor-produto-acabado.ts. Pedido do usuario em 21/08/2026.
const pedidosVendaData = JSON.parse(await fs.readFile(path.join(root, "public", "dados-pedidos-venda.json"), "utf8"));
const valoresProdutoAcabadoData = buildValorProdutoAcabado(pedidosVendaData, rawValor, estoqueData as never);
await fs.writeFile(path.join(root, "work", "valor-financeiro-produto-acabado-ci.json"), JSON.stringify(valoresProdutoAcabadoData, null, 2), "utf8");

// fornecedores_agregado.json ja vem pronto (agregado localmente por work/sheet-inspect/
// build_fornecedores.py a partir de compras_produto.json, ~87 MB - nunca buscado aqui, so o
// resultado ja agregado, ~1-2 MB). Busca isolada e tolerante: se o arquivo ainda nao existe no
// SharePoint (antes da primeira execucao local dessa pipeline) ou a busca falhar, nao derruba
// o resto do refresh - so fica sem o CI file, e build-github-pages.mjs cai pro placeholder.
let fornecedoresItens = { materia_prima: 0, produto_acabado: 0 };
try {
  const fornecedoresData = await fetchSharePointJson<{
    materia_prima: { listaFornecedores: unknown[] };
    produto_acabado: { listaFornecedores: unknown[] };
  }>("fornecedores_agregado.json");
  await fs.writeFile(path.join(root, "work", "valor-financeiro-fornecedores-ci.json"), JSON.stringify(fornecedoresData), "utf8");
  fornecedoresItens = {
    materia_prima: fornecedoresData.materia_prima.listaFornecedores.length,
    produto_acabado: fornecedoresData.produto_acabado.listaFornecedores.length,
  };
} catch (error) {
  console.warn(`fornecedores_agregado.json indisponivel no SharePoint (${(error as Error).message}) - build cai pro placeholder.`);
}

console.log(JSON.stringify({
  estoqueProdutos: (estoqueData as { produtos: unknown[] }).produtos.length,
  insumosProdutos: insumosData.produtos.length,
  consumoProdutos: (consumoData as { produtos: unknown[] }).produtos.length,
  mrpTerceirosProdutos: (mrpTerceirosData as { produtos: unknown[] }).produtos.length,
  escadinhaProdutos: (escadinhaData as { produtos: unknown[] }).produtos.length,
  valoresItens: valoresData.resumo.itens,
  valoresProdutoAcabadoItens: valoresProdutoAcabadoData.resumo.itens,
  fornecedoresItens,
}));
