// Porta para TypeScript a logica de work/sheet-inspect/build_bi_store_values.py, adaptada para
// consumir o JSON que o Power Automate grava no SharePoint (valor_insumos.json) em vez do
// snapshot manual antigo do Power BI. Validado em 05/08/2026 contra a saida do script Python
// (mesma ordem de grandeza; fontes de dias diferentes, entao nao e esperado bater centavo a
// centavo). Ver CLAUDE.md.

import { normalize, storeKeyFromName } from "./store-names";
import type insumosDataType from "../../public/dados-insumos.json";
import type valoresDataType from "../../data/dados-valores-insumos.json";

type InsumosData = typeof insumosDataType;
type InsumoItem = InsumosData["produtos"][number];
type ValoresData = typeof valoresDataType;
type ValorProduto = ValoresData["produtos"][number];

/**
 * Formato bruto de uma linha de valor_insumos.json (saida do fluxo do Power Automate).
 * Em 05/08/2026 os nomes vieram trocados na pratica: "descricao" chega como numero e o
 * texto do produto chega em "produto_key". descricaoTexto() abaixo funciona nos dois
 * formatos (atual trocado, ou corrigido no futuro), lendo qual dos dois campos e texto.
 */
export type ValorInsumosRow = {
  data: string;
  loja: string;
  departamento: string;
  categoria: string;
  grupo: string;
  descricao: string | number;
  produto_key?: string | number;
  valorEstoque: number;
  custoContabil: number | null;
};

function descricaoTexto(row: ValorInsumosRow): string {
  if (typeof row.descricao === "string") return row.descricao;
  if (typeof row.produto_key === "string") return row.produto_key;
  return String(row.descricao ?? row.produto_key ?? "");
}

const FINANCIAL_CATEGORIES = new Set([
  "17-FECULA",
  "EMBALAGEM PRIMARIA",
  "EMBALAGEM QUARTENARIA",
  "EMBALAGEM SECUNDARIA",
  "EMBALAGEM TERCIARIA",
  "ETIQUETAS E ROTULOS",
  "MATERIA PRIMA",
]);

function money(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

function classifyCategory(produto: string, tipo?: string): string {
  const name = normalize(produto);
  if (tipo === "Matéria-prima" || name === "MP" || name.startsWith("MP ")) return "Matéria-prima";
  if (name.includes("POUCH")) return "Saco pouch";
  if (name.startsWith("ETIQ") || name.includes("ROTULO")) return "Etiqueta";
  if (name.includes("CARTUCHO") || name.includes("CARTUXO")) return "Cartucho";
  if (name.includes("SACHE")) return "Etiqueta";
  if (name.includes("TAMPA")) return "Tampa";
  if (name.includes("BALDE SGF") || name.includes("BISNAGA") || name.includes("BALDE LISO OKKER 2 2") || name.includes("BALDE LISO OKKER 3 2")) return "Pote";
  if (name.includes("BOBINA")) return "Bobina";
  if (name.includes("SELO FECHA FACIL") || name.includes("SACO") || name.includes("FARDO") || name.includes("STRETCH")) return "Saco e stretch";
  if (name.includes("CAIXA")) return "Caixa";
  if (name.includes("POTE")) return "Pote";
  return "Outras embalagens";
}

function classifyBiCategory(categoria: string, produto: string): string {
  if (categoria === "MATERIA PRIMA" || categoria === "17-FECULA") return "Matéria-prima";
  if (categoria === "ETIQUETAS E ROTULOS") return "Etiqueta";
  return classifyCategory(produto, "Embalagem");
}

function skuFromBiName(name: string): string {
  const match = /^\s*(\d{3,})\s*[- ]/.exec(name ?? "");
  return match ? match[1] : "BI";
}

type BiRow = {
  loja: string;
  categoria: string;
  produto: string;
  valorEstoqueNumero: number;
  custoContabilNumero: number | null;
  nomeNormalizado: string;
};

export function buildValorInsumos(insumos: InsumosData, rawRows: ValorInsumosRow[]): ValoresData {
  const biRows: BiRow[] = [];
  const seenBi = new Set<string>();
  for (const row of rawRows) {
    const lojaKey = storeKeyFromName(row.loja);
    if (!lojaKey) continue;
    const descricao = descricaoTexto(row);
    const key = `${lojaKey}|${row.categoria}|${descricao}`;
    if (seenBi.has(key)) continue;
    seenBi.add(key);
    biRows.push({
      loja: lojaKey,
      categoria: row.categoria,
      produto: descricao,
      valorEstoqueNumero: row.valorEstoque ?? 0,
      custoContabilNumero: row.custoContabil,
      nomeNormalizado: normalize(descricao),
    });
  }

  const portfolioGroups = new Map<string, InsumoItem[]>();
  for (const item of insumos.produtos) {
    const key = `${classifyCategory(item.produto, item.tipo)}|${normalize(item.produto)}`;
    const group = portfolioGroups.get(key);
    if (group) group.push(item);
    else portfolioGroups.set(key, [item]);
  }

  const products: ValorProduto[] = [];
  const matchCounts: Record<string, number> = {};
  const matchedBiKeys = new Set<string>();

  for (const [groupKey, portfolioGroup] of portfolioGroups) {
    const separatorIndex = groupKey.indexOf("|");
    const category = groupKey.slice(0, separatorIndex);
    const localName = groupKey.slice(separatorIndex + 1);
    const base = portfolioGroup[0];

    let matches = biRows.filter((r) => r.nomeNormalizado === localName);
    let method = "nome exato no BI";

    if (matches.length === 0) {
      const oldNames = new Set(
        portfolioGroup
          .map((item) => (item as { descricaoBi?: string }).descricaoBi)
          .filter((v): v is string => Boolean(v))
          .map((v) => normalize(v)),
      );
      matches = biRows.filter((r) => oldNames.has(r.nomeNormalizado));
      method = "descrição relacionada";
    }
    if (matches.length === 0 && localName.length >= 36) {
      const prefixMatches = biRows.filter((r) => r.nomeNormalizado.startsWith(localName));
      if (prefixMatches.length > 0) {
        matches = prefixMatches;
        method = "nome consolidado no BI";
      }
    }

    for (const row of matches) matchedBiKeys.add(`${row.loja}|${row.categoria}|${row.produto}`);

    const localByStore = new Map<string, InsumoItem[]>();
    for (const item of portfolioGroup) {
      const k = String(item.loja);
      const arr = localByStore.get(k);
      if (arr) arr.push(item);
      else localByStore.set(k, [item]);
    }
    const matchesByStore = new Map<string, BiRow[]>();
    for (const row of matches) {
      const arr = matchesByStore.get(row.loja);
      if (arr) arr.push(row);
      else matchesByStore.set(row.loja, [row]);
    }

    const stores = new Set(localByStore.keys());
    for (const [store, rows] of matchesByStore) {
      if (rows.some((r) => r.valorEstoqueNumero > 0)) stores.add(store);
    }

    for (const store of stores) {
      const localGroup = localByStore.get(store) ?? [];
      const storeMatches = matchesByStore.get(store) ?? [];
      const itemBase = localGroup[0] ?? base;

      const deliveriesByDate = new Map<string, number>();
      for (const item of localGroup) {
        for (const delivery of item.entregasProgramadas) {
          deliveriesByDate.set(delivery.data, (deliveriesByDate.get(delivery.data) ?? 0) + delivery.quantidade);
        }
      }

      let stockValue: number | null = null;
      let accountingCost: number | null = null;
      let biDescription: string | null = null;
      if (storeMatches.length > 0) {
        stockValue = money(storeMatches.reduce((s, r) => s + r.valorEstoqueNumero, 0));
        const positiveValueRows = storeMatches.filter((r) => r.valorEstoqueNumero > 0 && (r.custoContabilNumero ?? 0) > 0);
        const pricedRows = positiveValueRows.length > 0 ? positiveValueRows : storeMatches.filter((r) => (r.custoContabilNumero ?? 0) > 0);
        if (pricedRows.length > 0) {
          const weights = pricedRows.map((r) => (r.valorEstoqueNumero > 0 ? r.valorEstoqueNumero : 1));
          const weightSum = weights.reduce((a, b) => a + b, 0);
          accountingCost = money(pricedRows.reduce((s, r, i) => s + (r.custoContabilNumero ?? 0) * weights[i], 0) / weightSum);
        }
        biDescription = [...new Set(storeMatches.map((r) => r.produto))].sort().join(" + ");
        matchCounts[method] = (matchCounts[method] ?? 0) + 1;
      } else {
        matchCounts["não localizado"] = (matchCounts["não localizado"] ?? 0) + 1;
      }

      const deliveries = [...deliveriesByDate.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([data, quantidade]) => ({
          data,
          quantidade: Math.round(quantidade * 1000) / 1000,
          valor: accountingCost !== null ? money(quantidade * accountingCost) : null,
        }));

      const scheduledQuantity = Math.round(deliveries.reduce((s, d) => s + d.quantidade, 0) * 1000) / 1000;
      const deliveriesValue = accountingCost !== null ? money(deliveries.reduce((s, d) => s + (d.valor ?? 0), 0)) : null;
      const afterDeliveries = stockValue !== null && accountingCost !== null ? money((stockValue ?? 0) + (deliveriesValue ?? 0)) : null;
      const localStock = localGroup.reduce((s, i) => s + i.estoque, 0);
      const inferredStock = stockValue !== null && accountingCost ? stockValue / accountingCost : 0;
      // Estoque atual passa a vir do proprio BI (Valor em estoque / Custo contabil) sempre que
      // tiver os dois - assim nunca contradiz o Valor em estoque mostrado do lado, mesmo que a
      // planilha local esteja num dia diferente do snapshot do Power BI. So cai pro estoque
      // local quando o produto nao tem valor/custo do BI. Ver conversa 13/08/2026.
      const estoqueFinal = stockValue !== null && accountingCost ? inferredStock : localStock;

      products.push({
        categoria: category,
        sku: localGroup.length > 0 ? [...new Set(localGroup.map((i) => i.sku))].join(" / ") : itemBase.sku,
        produto: itemBase.produto,
        fornecedor: localGroup.length > 0 ? [...new Set(localGroup.map((i) => i.fornecedor))].join(" / ") : itemBase.fornecedor,
        loja: store,
        unidade: itemBase.unidade,
        estoque: Math.round(estoqueFinal * 1000) / 1000,
        precoAtual: accountingCost,
        descricaoBi: biDescription,
        metodoRelacionamento: storeMatches.length > 0 ? method : null,
        valorEstoque: stockValue,
        totalProgramado: scheduledQuantity,
        valorEntregas: deliveriesValue,
        valorAposEntregas: afterDeliveries,
        entregasProgramadas: deliveries,
      } as ValorProduto);
    }
  }

  for (const row of biRows) {
    const rowKey = `${row.loja}|${row.categoria}|${row.produto}`;
    if (matchedBiKeys.has(rowKey) || !FINANCIAL_CATEGORIES.has(row.categoria)) continue;
    const accountingCost = row.custoContabilNumero;
    const stockValue = money(row.valorEstoqueNumero);
    const inferredStock = accountingCost && stockValue ? stockValue / accountingCost : 0;
    const category = classifyBiCategory(row.categoria, row.produto);
    const unit = category === "Bobina" || category === "Matéria-prima" ? "kg" : "unidade";
    products.push({
      categoria: category,
      sku: skuFromBiName(row.produto),
      produto: row.produto,
      fornecedor: "Somente no Power BI",
      loja: row.loja,
      unidade: unit,
      estoque: Math.round(inferredStock * 1000) / 1000,
      precoAtual: accountingCost !== null && accountingCost !== undefined ? money(accountingCost) : null,
      descricaoBi: row.produto,
      metodoRelacionamento: "somente no BI",
      valorEstoque: stockValue,
      totalProgramado: 0,
      valorEntregas: accountingCost !== null && accountingCost !== undefined ? 0 : null,
      valorAposEntregas: accountingCost !== null && accountingCost !== undefined ? stockValue : null,
      entregasProgramadas: [],
    } as ValorProduto);
    matchCounts["somente no BI"] = (matchCounts["somente no BI"] ?? 0) + 1;
  }

  products.sort((a, b) => {
    if (a.categoria !== b.categoria) return a.categoria < b.categoria ? -1 : 1;
    if (a.produto !== b.produto) return a.produto < b.produto ? -1 : 1;
    const aLoja = Number(a.loja);
    const bLoja = Number(b.loja);
    if (!Number.isNaN(aLoja) && !Number.isNaN(bLoja)) return aLoja - bLoja;
    return String(a.loja).localeCompare(String(b.loja));
  });

  function summarize(items: ValorProduto[]) {
    return {
      itens: items.length,
      comPreco: items.filter((i) => i.precoAtual !== null).length,
      semPreco: items.filter((i) => i.precoAtual === null).length,
      valorEstoque: money(items.reduce((s, i) => s + (i.valorEstoque ?? 0), 0)),
      valorEntregas: money(items.reduce((s, i) => s + (i.valorEntregas ?? 0), 0)),
      valorAposEntregas: money(items.reduce((s, i) => s + (i.valorAposEntregas ?? 0), 0)),
    };
  }

  const categorias = [...new Set(products.map((p) => p.categoria))].sort();
  const dataReferencia = rawRows[0]?.data ?? null;

  return {
    atualizadoEm: new Date().toISOString(),
    dataReferencia,
    precosExtraidosEm: new Date().toISOString(),
    origemEstoque: "Power BI (via Power Automate) / Estoque_historico_custo / Estoque R$",
    origemPreco: "Power BI (via Power Automate) / Estoque_historico_custo / ficha custo.custo_contabil",
    moeda: "BRL",
    resumo: summarize(products),
    porCategoria: Object.fromEntries(categorias.map((c) => [c, summarize(products.filter((p) => p.categoria === c))])),
    relacionamentos: matchCounts,
    produtos: products,
  } as unknown as ValoresData;
}
