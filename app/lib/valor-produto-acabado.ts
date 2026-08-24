// Valor em estoque de produto acabado - mesmo parametro do valor dos insumos (valor-insumos.ts):
// custo contabil x estoque, por produto e loja, saindo do mesmo valor_insumos.json (Power
// Automate). Pedido do usuario em 21/08/2026.
//
// Achado real (21/08/2026, testado com o arquivo real via debug_vpa.mts): o custo contabil de
// produto acabado no BI quase sempre vem preenchido na variante UNITARIA, nunca nas variantes
// de caixa/fardo que a aba Estoque x Pedidos usa (a correspondencia direta por produto_key da
// CX/FD deu 0 de 500 itens com preco). Produtos irmaos (mesma familia, embalagens diferentes)
// compartilham o mesmo codigo de 5 digitos no inicio da descricao ("00001 TAPIOCA DA TERRINHA
// 1 KG - CX 12" e "00001 TAPIOCA DA TERRINHA 1 KG - UND" sao o mesmo produto) - nao ha campo de
// ligacao limpo no produto_d (grade_produto_key/produto_nacional_key vieram vazios nos
// testados). Por isso o cruzamento e: acha a variante unitaria do BI com o mesmo prefixo de 5
// digitos + mesma loja, multiplica o custo unitario pelo tamanho da embalagem (extraido do
// proprio texto, "CX 12"/"FD 24" => 12/24 unidades) pra chegar no custo por caixa/fardo.
//
// A variante unitaria nem sempre diz "- UND" explicitamente: produtos como "20004 PIPOCA DE
// MICROONDAS MANTEIGA CINEMA DA TERRINHA 85G" (sem sufixo nenhum) tambem sao custo por unidade -
// ver ehVarianteUnitaria() abaixo (achado real via diagnostico no CI, 21/08/2026).

import { storeKeyFromName } from "./store-names";
import type pedidosVendaDataType from "../../public/dados-pedidos-venda.json";
import type estoqueDataType from "../../public/dados-estoque.json";
import type valoresDataType from "../../data/dados-valores-produto-acabado.json";
import type { ValorInsumosRow } from "./valor-insumos";

type PedidosVendaData = typeof pedidosVendaDataType;
type PedidoVendaItem = PedidosVendaData["produtos"][number];
type EstoqueData = typeof estoqueDataType;
type ValoresProdutoAcabadoData = typeof valoresDataType;
type ValorProdutoAcabado = ValoresProdutoAcabadoData["produtos"][number];

export const PRODUCAO_PROPRIA = "Produção própria";

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
  // A maioria dos codigos tem 5 digitos ("00001"), mas existe pelo menos um caso real de 6
  // digitos ("002439 FECULA MANDIOCA DA TERRINHA 1 KG") - com \d{5} fixo esse produto nunca
  // batia (o regex nao casava nada, nem os 5 primeiros digitos, porque exige espaco logo
  // depois do quinto digito). Achado real via print do usuario em 24/08/2026.
  const m = /^\s*(\d{4,6})\s/.exec(texto);
  return m ? m[1] : null;
}

// Fallback pra quando a descricao nao tem nenhum codigo numerico no inicio (ex.: "SEMOLA DE
// MILHO MESTRE CUCA 1 kg - UND", sem prefixo) - nesse caso o unico jeito de achar a variante
// unitaria irma e comparar o nome depois de tirar a parte de embalagem (UND/CX n/FD n do
// final). Achado real via print do usuario em 24/08/2026.
// "17-FECULA" no BI mistura matéria-prima a granel (ex. "09003 FECULA MANDIOCA TERRAFEC KG",
// "09011 FECULA MANDIOCA TERRINHA KG" - sem "DA " antes de TERRINHA, sem embalagem) com
// produto acabado embalado da marca DA TERRINHA (ex. "002439 FECULA MANDIOCA DA TERRINHA 1 KG
// - UND"). So a granel deveria ficar de fora; a marca "DA TERRINHA" e o sinal mais confiavel
// pra distinguir. Achado real via print do usuario em 24/08/2026 (essa fecula sumia da aba).
function ehFeculaEmbaladaDaTerrinha(descricao: string): boolean {
  return /DA TERRINHA/i.test(descricao);
}

function nomeBase(texto: string): string {
  let s = texto.trim().toUpperCase();
  for (let i = 0; i < 5; i++) {
    const antes = s;
    s = s.replace(/\s*-?\s*UND\s*$/i, "").replace(/\s*-?\s*(?:CX|FD)\s*\d+(?:[.,]\d+)?\s*$/i, "").trim();
    if (s === antes) break;
  }
  return s;
}

// Nem toda linha "unitaria" do BI diz "- UND" explicitamente: produtos como "20004 PIPOCA DE
// MICROONDAS MANTEIGA CINEMA DA TERRINHA 85G" (sem nenhum sufixo) ou "40002 - CEBOLA GRANULADA
// OKKER 400 GR" tambem sao custo por unidade, so nao tem embalagem de caixa/fardo anotada no
// texto. Por isso: conta como variante unitaria quando tem "- UND" OU quando nao tem nenhuma
// contagem de CX/FD no texto (achado real via diagnostico no CI, 21/08/2026 - a pipoca CX 24
// ficava sem custo porque a linha do BI e so "...85G", sem "- UND").
function temContagemDeEmbalagem(texto: string): boolean {
  return /\b(?:CX|FD)\s*\d+/i.test(texto);
}

function ehVarianteUnitaria(texto: string): boolean {
  return /-\s*UND\b/i.test(texto) || !temContagemDeEmbalagem(texto);
}

function multiplicadorEmbalagem(texto: string): number {
  // Sem dash obrigatorio antes de CX/FD: a descricao de venda usa "85G CX 24" (espaco), nao
  // "- CX 24" (com dash) como algumas linhas do BI.
  const m = /\b(?:CX|FD)\s*(\d+)/i.exec(texto);
  return m ? Number(m[1]) : 1;
}

export function buildValorProdutoAcabado(pedidosVenda: PedidosVendaData, rawRows: ValorInsumosRow[], estoqueTerceiros: EstoqueData): ValoresProdutoAcabadoData {
  // Fornecedor terceirizado real por SKU (ex.: BATATA PALHA -> ART FRITAS): so existe pra quem
  // e fabricado por terceiro, vem de dados-estoque.json (mesma base da aba Estoque de
  // terceiros, onde "loja" = fornecedor). Produto sem correspondencia la e produzido na propria
  // Da Terrinha. Pedido do usuario em 21/08/2026.
  const fornecedorPorSku = new Map<string, string>();
  for (const item of estoqueTerceiros.produtos as { sku: string; fornecedor: string }[]) {
    if (item.fornecedor && !fornecedorPorSku.has(item.sku)) fornecedorPorSku.set(item.sku, item.fornecedor);
  }

  // custoUnitarioPorCodigoLoja: "codigoBase|lojaKey" -> lista de custos unitarios (BI, variante UND)
  // custoUnitarioPorNomeLoja: mesma ideia, mas por nome normalizado - fallback pra descricao
  // sem nenhum codigo numerico no inicio (ex.: SEMOLA).
  const custoUnitarioPorCodigoLoja = new Map<string, number[]>();
  const custoUnitarioPorNomeLoja = new Map<string, number[]>();
  for (const row of rawRows) {
    const descricao = descricaoTexto(row);
    const ehExcecaoFeculaAcabada = row.categoria === "17-FECULA" && ehFeculaEmbaladaDaTerrinha(descricao);
    if (CATEGORIAS_NAO_ACABADO.has(row.categoria) && !ehExcecaoFeculaAcabada) continue;
    if (row.custoContabil == null || row.custoContabil <= 0) continue;
    if (!ehVarianteUnitaria(descricao)) continue;
    const lojaKey = storeKeyFromName(row.loja);
    if (!lojaKey) continue;
    const codigo = codigoBase(descricao);
    if (codigo) {
      const key = `${codigo}|${lojaKey}`;
      const lista = custoUnitarioPorCodigoLoja.get(key);
      if (lista) lista.push(row.custoContabil);
      else custoUnitarioPorCodigoLoja.set(key, [row.custoContabil]);
    } else {
      const key = `${nomeBase(descricao)}|${lojaKey}`;
      const lista = custoUnitarioPorNomeLoja.get(key);
      if (lista) lista.push(row.custoContabil);
      else custoUnitarioPorNomeLoja.set(key, [row.custoContabil]);
    }
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
      const custosUnitarios = (codigo ? custoUnitarioPorCodigoLoja.get(`${codigo}|${lojaKey}`) : undefined)
        ?? custoUnitarioPorNomeLoja.get(`${nomeBase(item.produto)}|${lojaKey}`);

      let custoContabil: number | null = null;
      if (custosUnitarios && custosUnitarios.length > 0) {
        const custoUnitarioMedio = custosUnitarios.reduce((a, b) => a + b, 0) / custosUnitarios.length;
        custoContabil = money(custoUnitarioMedio * multiplicador);
      }
      const valorEstoque = custoContabil !== null ? money(item.estoque * custoContabil) : null;
      // Loja sem chave em store-names.ts (ex.: "Da Terrinha - Cambuci") nunca vai casar custo -
      // nao conta como "produto sem preco" pra nao inflar esse indicador com algo que nao e um
      // problema de dado, e sim de loja ainda nao mapeada. Pedido do usuario em 24/08/2026.
      const lojaMapeada = storeKeyFromName(item.loja) !== null;
      if (lojaMapeada) { if (custoContabil !== null) comPreco++; else semPreco++; }

      products.push({
        categoria: base.categoria ?? "Sem categoria",
        sku: String(item.cod),
        produto: item.produto,
        fornecedor: fornecedorPorSku.get(String(item.cod)) ?? PRODUCAO_PROPRIA,
        loja: lojaKey,
        unidade: "cx",
        estoque: item.estoque,
        precoAtual: custoContabil,
        descricaoBi: custoContabil !== null ? `Custo unitário do BI × ${multiplicador} un./caixa` : null,
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
    // comPreco/semPreco so contam loja com chave em store-names.ts - loja sem mapeamento (ex.:
    // Da Terrinha - Cambuci) nunca vai casar custo, entao entrar nessa conta infla o indicador
    // com algo que nao e um problema de dado. Ver nota acima, no loop principal.
    const comMapeamento = items.filter((i) => !Number.isNaN(Number(i.loja)));
    return {
      itens: items.length,
      comPreco: comMapeamento.filter((i) => i.precoAtual !== null).length,
      semPreco: comMapeamento.filter((i) => i.precoAtual === null).length,
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
