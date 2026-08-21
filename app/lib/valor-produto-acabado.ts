// Valor em estoque de produto acabado - mesmo parametro do valor dos insumos (valor-insumos.ts):
// custo contabil x estoque, por produto e loja, saindo do mesmo valor_insumos.json (Power
// Automate). Aqui o cruzamento e mais simples que o de insumos porque valor_insumos.json ja
// traz "produto_key" (mesmo codigo usado em dados-pedidos-venda.json/cod) - nao precisa de
// correspondencia por nome normalizado. Pedido do usuario em 21/08/2026.

import { storeKeyFromName } from "./store-names";
import type pedidosVendaDataType from "../../public/dados-pedidos-venda.json";
import type valoresDataType from "../../data/dados-valores-produto-acabado.json";
import type { ValorInsumosRow } from "./valor-insumos";

type PedidosVendaData = typeof pedidosVendaDataType;
type PedidoVendaItem = PedidosVendaData["produtos"][number];
type ValoresProdutoAcabadoData = typeof valoresDataType;
type ValorProdutoAcabado = ValoresProdutoAcabadoData["produtos"][number];

// Categorias de insumo/embalagem/terceirizado do mesmo valor_insumos.json - tudo que nao for
// isso e produto acabado (a numeracao "01-", "02-"... e so ordem de exibicao do BI, nao uma
// lista fixa - novas categorias numeradas devem continuar caindo aqui como produto acabado).
const CATEGORIAS_NAO_ACABADO = new Set([
  "17-FECULA",
  "EMBALAGEM PRIMARIA",
  "EMBALAGEM QUARTENARIA",
  "EMBALAGEM SECUNDARIA",
  "EMBALAGEM TERCIARIA",
  "ETIQUETAS E ROTULOS",
  "MATERIA PRIMA",
  "TERCEIRIZADOS",
]);

function money(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

function descricaoTexto(row: ValorInsumosRow): string {
  if (typeof row.descricao === "string") return row.descricao;
  if (typeof row.produto_key === "string") return row.produto_key;
  return String(row.descricao ?? row.produto_key ?? "");
}

function produtoKeyDeLinha(row: ValorInsumosRow): number | null {
  if (typeof row.produto_key === "number") return row.produto_key;
  if (typeof row.produto_key === "string" && /^\d+$/.test(row.produto_key)) return Number(row.produto_key);
  return null;
}

export function buildValorProdutoAcabado(pedidosVenda: PedidosVendaData, rawRows: ValorInsumosRow[]): ValoresProdutoAcabadoData {
  type BiRow = { loja: string; categoria: string; produto: string; valorEstoqueNumero: number; custoContabilNumero: number | null };
  const biPorProdutoLoja = new Map<string, BiRow[]>();
  for (const row of rawRows) {
    if (CATEGORIAS_NAO_ACABADO.has(row.categoria)) continue;
    const lojaKey = storeKeyFromName(row.loja);
    const produtoKey = produtoKeyDeLinha(row);
    if (!lojaKey || produtoKey == null) continue;
    const key = `${produtoKey}|${lojaKey}`;
    const biRow: BiRow = {
      loja: lojaKey,
      categoria: row.categoria,
      produto: descricaoTexto(row),
      valorEstoqueNumero: row.valorEstoque ?? 0,
      custoContabilNumero: row.custoContabil,
    };
    const lista = biPorProdutoLoja.get(key);
    if (lista) lista.push(biRow);
    else biPorProdutoLoja.set(key, [biRow]);
  }

  // Agrupa dados-pedidos-venda.json por produto (mesmo cod entre lojas) - mesma unidade de
  // analise da aba Estoque x Pedidos, ver DashboardClient.tsx "agrupados".
  const porCodigo = new Map<number, PedidoVendaItem[]>();
  for (const item of pedidosVenda.produtos as PedidoVendaItem[]) {
    const lista = porCodigo.get(item.cod);
    if (lista) lista.push(item);
    else porCodigo.set(item.cod, [item]);
  }

  const products: ValorProdutoAcabado[] = [];
  let comPreco = 0;
  let semPreco = 0;
  const matchedBiKeys = new Set<string>();

  for (const [cod, itens] of porCodigo) {
    const base = itens[0];
    for (const item of itens) {
      const lojaKey = storeKeyFromName(item.loja) ?? item.loja;
      const key = `${cod}|${lojaKey}`;
      const biRows = biPorProdutoLoja.get(key) ?? [];
      biRows.forEach((_r, i) => matchedBiKeys.add(`${key}|${i}`));

      let valorEstoque: number | null = null;
      let custoContabil: number | null = null;
      if (biRows.length > 0) {
        valorEstoque = money(biRows.reduce((s, r) => s + r.valorEstoqueNumero, 0));
        const comCusto = biRows.filter((r) => (r.custoContabilNumero ?? 0) > 0);
        if (comCusto.length > 0) {
          const pesos = comCusto.map((r) => (r.valorEstoqueNumero > 0 ? r.valorEstoqueNumero : 1));
          const somaPesos = pesos.reduce((a, b) => a + b, 0);
          custoContabil = money(comCusto.reduce((s, r, i) => s + (r.custoContabilNumero ?? 0) * pesos[i], 0) / somaPesos);
        }
      }
      if (custoContabil !== null) comPreco++; else semPreco++;

      products.push({
        categoria: base.categoria ?? "Sem categoria",
        sku: String(cod),
        produto: item.produto,
        fornecedor: item.loja,
        loja: lojaKey,
        unidade: "cx",
        estoque: item.estoque,
        precoAtual: custoContabil,
        descricaoBi: biRows.length > 0 ? [...new Set(biRows.map((r) => r.produto))].join(" + ") : null,
        metodoRelacionamento: biRows.length > 0 ? "produto_key + loja" : null,
        valorEstoque,
        totalProgramado: 0,
        valorEntregas: custoContabil !== null ? 0 : null,
        valorAposEntregas: valorEstoque,
        entregasProgramadas: [],
      } as ValorProdutoAcabado);
    }
  }

  products.sort((a, b) => {
    if (a.categoria !== b.categoria) return a.categoria < b.categoria ? -1 : 1;
    return a.produto < b.produto ? -1 : a.produto > b.produto ? 1 : 0;
  });

  function summarize(items: ValorProdutoAcabado[]) {
    return {
      itens: items.length,
      comPreco: items.filter((i) => i.precoAtual !== null).length,
      semPreco: items.filter((i) => i.precoAtual === null).length,
      valorEstoque: money(items.reduce((s, i) => s + (i.valorEstoque ?? 0), 0)),
      valorEntregas: 0,
      valorAposEntregas: money(items.reduce((s, i) => s + (i.valorAposEntregas ?? 0), 0)),
    };
  }

  const categorias = [...new Set(products.map((p) => p.categoria))].sort();
  const dataReferencia = rawRows[0]?.data ?? null;

  return {
    atualizadoEm: new Date().toISOString(),
    dataReferencia,
    precosExtraidosEm: new Date().toISOString(),
    origemEstoque: "produtos_estoque.json (Power Automate) via dados-pedidos-venda.json",
    origemPreco: "Power BI (via Power Automate) / valor_insumos.json / ficha_custo.custo_contabil",
    moeda: "BRL",
    resumo: summarize(products),
    porCategoria: Object.fromEntries(categorias.map((c) => [c, summarize(products.filter((p) => p.categoria === c))])),
    relacionamentos: { "produto_key + loja": comPreco, "não localizado": semPreco },
    produtos: products,
  } as unknown as ValoresProdutoAcabadoData;
}
