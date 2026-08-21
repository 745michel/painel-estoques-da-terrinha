// Valor em estoque de produto acabado - mesmo parametro do valor dos insumos (valor-insumos.ts):
// custo contabil x estoque, por produto e loja, saindo do mesmo valor_insumos.json (Power
// Automate). Pedido do usuario em 21/08/2026.
//
// Achado real (21/08/2026, testado com o arquivo real via debug_vpa.mts): o custo contabil de
// produto acabado no BI so vem preenchido na variante UNITARIA (embalagem "- UND"), nunca nas
// variantes de caixa/fardo que a aba Estoque x Pedidos usa (2.469 de 2.915 linhas com custo
// tem sufixo "- UND"; a correspondencia direta por produto_key da CX/FD deu 0 de 500 itens
// com preco). Produtos irmaos (mesma familia, embalagens diferentes) compartilham o mesmo
// codigo de 5 digitos no inicio da descricao ("00001 TAPIOCA DA TERRINHA 1 KG - CX 12" e
// "00001 TAPIOCA DA TERRINHA 1 KG - UND" sao o mesmo produto) - nao ha campo de ligacao limpo
// no produto_d (grade_produto_key/produto_nacional_key vieram vazios nos testados). Por isso
// o cruzamento e: acha a variante UND do BI com o mesmo prefixo de 5 digitos + mesma loja,
// multiplica o custo unitario pelo tamanho da embalagem (extraido do proprio texto, "CX 12"/
// "FD 24" => 12/24 unidades) pra chegar no custo por caixa/fardo.

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

function codigoBase(texto: string): string | null {
  const m = /^\s*(\d{5})\s/.exec(texto);
  return m ? m[1] : null;
}

function ehVarianteUnitaria(texto: string): boolean {
  return /-\s*UND\s*$/i.test(texto.trim());
}

function multiplicadorEmbalagem(texto: string): number {
  const m = /-\s*(?:CX|FD)\s*(\d+)/i.exec(texto);
  return m ? Number(m[1]) : 1;
}

export function buildValorProdutoAcabado(pedidosVenda: PedidosVendaData, rawRows: ValorInsumosRow[]): ValoresProdutoAcabadoData {
  // custoUnitarioPorCodigoLoja: "codigoBase|lojaKey" -> lista de custos unitarios (BI, variante UND)
  const custoUnitarioPorCodigoLoja = new Map<string, number[]>();
  for (const row of rawRows) {
    if (CATEGORIAS_NAO_ACABADO.has(row.categoria)) continue;
    if (row.custoContabil == null || row.custoContabil <= 0) continue;
    const descricao = descricaoTexto(row);
    if (!ehVarianteUnitaria(descricao)) continue;
    const codigo = codigoBase(descricao);
    const lojaKey = storeKeyFromName(row.loja);
    if (!codigo || !lojaKey) continue;
    const key = `${codigo}|${lojaKey}`;
    const lista = custoUnitarioPorCodigoLoja.get(key);
    if (lista) lista.push(row.custoContabil);
    else custoUnitarioPorCodigoLoja.set(key, [row.custoContabil]);
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

  for (const [, itens] of porCodigo) {
    const base = itens[0];
    const codigo = codigoBase(base.produto);
    const multiplicador = multiplicadorEmbalagem(base.produto);

    for (const item of itens) {
      const lojaKey = storeKeyFromName(item.loja) ?? item.loja;
      const custosUnitarios = codigo ? custoUnitarioPorCodigoLoja.get(`${codigo}|${lojaKey}`) : undefined;

      let custoContabil: number | null = null;
      if (custosUnitarios && custosUnitarios.length > 0) {
        const custoUnitarioMedio = custosUnitarios.reduce((a, b) => a + b, 0) / custosUnitarios.length;
        custoContabil = money(custoUnitarioMedio * multiplicador);
      }
      const valorEstoque = custoContabil !== null ? money(item.estoque * custoContabil) : null;
      if (custoContabil !== null) comPreco++; else semPreco++;

      products.push({
        categoria: base.categoria ?? "Sem categoria",
        sku: String(item.cod),
        produto: item.produto,
        fornecedor: item.loja,
        loja: lojaKey,
        unidade: "cx",
        estoque: item.estoque,
        precoAtual: custoContabil,
        descricaoBi: custoContabil !== null ? `Custo unitário (variante UND) × ${multiplicador} un./caixa` : null,
        metodoRelacionamento: custoContabil !== null ? "custo unitário × embalagem" : null,
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
    origemPreco: "Power BI (via Power Automate) / valor_insumos.json / ficha_custo.custo_contabil (variante unitária × tamanho da embalagem)",
    moeda: "BRL",
    resumo: summarize(products),
    porCategoria: Object.fromEntries(categorias.map((c) => [c, summarize(products.filter((p) => p.categoria === c))])),
    relacionamentos: { "custo unitário × embalagem": comPreco, "não localizado": semPreco },
    produtos: products,
  } as unknown as ValoresProdutoAcabadoData;
}
