// Roda dentro do GitHub Actions (secrets protegidos la, nunca expostos ao navegador).
// Busca os 4 datasets do SharePoint e grava:
//   - public/dados-estoque.json, dados-insumos.json, dados-consumo-insumos.json
//     (operacional - embutido no bundle estatico pelo build-github-pages.mjs)
//   - work/valor-financeiro-ci.json (financeiro - fica FORA do bundle, copiado como
//     arquivo separado por build-github-pages.mjs, so buscado depois da senha no navegador)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSharePointJson } from "../app/lib/sharepoint";
import { buildValorInsumos, type ValorInsumosRow } from "../app/lib/valor-insumos";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await fs.mkdir(path.join(root, "work"), { recursive: true });

const estoqueData = await fetchSharePointJson("dados-estoque.json");
const insumosData = await fetchSharePointJson<{ produtos: unknown[] }>("dados-insumos.json");
const consumoData = await fetchSharePointJson("dados-consumo-insumos.json");
const rawValor = await fetchSharePointJson<ValorInsumosRow[]>("valor_insumos.json");
const valoresData = buildValorInsumos(insumosData as never, rawValor);

await fs.writeFile(path.join(root, "public", "dados-estoque.json"), JSON.stringify(estoqueData, null, 2), "utf8");
await fs.writeFile(path.join(root, "public", "dados-insumos.json"), JSON.stringify(insumosData, null, 2), "utf8");
await fs.writeFile(path.join(root, "public", "dados-consumo-insumos.json"), JSON.stringify(consumoData, null, 2), "utf8");
await fs.writeFile(path.join(root, "work", "valor-financeiro-ci.json"), JSON.stringify(valoresData, null, 2), "utf8");

console.log(JSON.stringify({
  estoqueProdutos: (estoqueData as { produtos: unknown[] }).produtos.length,
  insumosProdutos: insumosData.produtos.length,
  consumoProdutos: (consumoData as { produtos: unknown[] }).produtos.length,
  valoresItens: valoresData.resumo.itens,
}));
