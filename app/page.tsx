import { redirect } from "next/navigation";
import { auth, signOut } from "../auth";
import DashboardClient from "./DashboardClient";
import estoqueDataStatic from "../public/dados-estoque.json";
import insumosDataStatic from "../public/dados-insumos.json";
import consumoDataStatic from "../public/dados-consumo-insumos.json";
import valoresDataStatic from "../data/dados-valores-insumos.json";
import mrpTerceirosDataStatic from "../public/dados-mrp-terceiros.json";
import escadinhaDataStatic from "../public/dados-escadinha.json";
import escadinhaInsumosDataStatic from "../public/dados-escadinha-insumos.json";
import pedidosVendaDataStatic from "../public/dados-pedidos-venda.json";
import cortesDataStatic from "../public/dados-cortes.json";
import valoresProdutoAcabadoDataStatic from "../data/dados-valores-produto-acabado.json";
import fornecedoresDataStatic from "../data/dados-fornecedores.json";
import cortesValoresDataStatic from "../data/dados-cortes-valores.json";
import validadeDataStatic from "../data/dados-validade.json";
import { fetchSharePointJson, isConfigured } from "./lib/sharepoint";
import { isDbConfigured, queryRows, queryMeta, querySnapshot } from "./lib/pg";
import { resolveAccess } from "./lib/access";
import { SECTION_KEYS, type Section } from "./lib/sections";

export const dynamic = "force-dynamic";

type EstoqueData = typeof estoqueDataStatic;
type InsumosData = typeof insumosDataStatic;
type ConsumoData = typeof consumoDataStatic;
type ValoresData = typeof valoresDataStatic;
type MrpTerceirosData = typeof mrpTerceirosDataStatic;
type EscadinhaData = typeof escadinhaDataStatic;
type EscadinhaInsumosData = typeof escadinhaInsumosDataStatic;
type PedidosVendaData = typeof pedidosVendaDataStatic;
// Tipo declarado a mao (nao "typeof cortesDataStatic") de proposito: logo apos criado,
// dados-cortes.json tem motivo/observacoes sempre null (ninguem preencheu a planilha ainda) -
// inferir do arquivo real travaria os dois campos no tipo literal "null". Mesmo motivo da
// mesma decisao em DashboardClient.tsx.
type CortesLinha = {
  data: string;
  lojaKey: number | null;
  loja: string;
  produtoKey: number;
  produto: string | null;
  quantidadePedidaCx: number;
  quantidadeFaturadaCx: number;
  corteCx: number;
  motivo: string | null;
  observacoes: string | null;
  categoria: string | null;
  setor: string | null;
};
type AtendidoLinha = {
  mes: string;
  lojaKey: number | null;
  loja: string;
  produtoKey: number;
  produto: string | null;
  quantidadeFaturadaCx: number;
  categoria: string | null;
};
type CortesData = {
  atualizadoEm: string;
  origem: string;
  cortes: CortesLinha[];
  totalLinhas: number;
  semMotivo: number;
  atendidos: AtendidoLinha[];
};
type ValoresProdutoAcabadoData = typeof valoresProdutoAcabadoDataStatic;
type FornecedoresData = typeof fornecedoresDataStatic;
// Valor de corte/faturamento (R$) - financeiro, mesma senha das outras 3 abas. Tipo a mao
// pelo mesmo motivo de CortesData acima.
type CortesValorLinha = {
  data: string;
  lojaKey: number | null;
  produtoKey: number;
  valorPedidoTotal: number;
  faturamentoRs: number;
  valorCorte: number;
};
type AtendidoValorLinha = {
  mes: string;
  lojaKey: number | null;
  produtoKey: number;
  faturamentoRs: number;
  valorPedidoTotal: number;
};
type CortesValoresData = {
  atualizadoEm: string;
  origem: string;
  valores: CortesValorLinha[];
  valoresAtendidos: AtendidoValorLinha[];
};
type ValidadeData = typeof validadeDataStatic;

/**
 * Cada loadX tenta o SharePoint (dados atualizados 2x/dia pela automacao local +
 * Power Automate, independente desta maquina) e cai para o JSON estatico do build se o
 * Graph nao estiver configurado ou a busca falhar - o painel nunca fica fora do ar por
 * causa disso, so mostra dados potencialmente desatualizados. Ver CLAUDE.md.
 */
async function loadEstoqueData(): Promise<EstoqueData> {
  // Fase 3 da migracao Railway (ver CLAUDE.md): le do Postgres (sincronizado 3x/dia pela
  // automacao local, automation/sincronizar_postgres.ps1) em vez do SharePoint ao vivo. Cai
  // pro snapshot do build se o Postgres nao estiver configurado ou a consulta falhar - o
  // painel nunca fica fora do ar por causa disso.
  if (!isDbConfigured()) return estoqueDataStatic;
  try {
    const [produtos, meta] = await Promise.all([queryRows("estoque_terceiros"), queryMeta("estoque_terceiros")]);
    return { ...(meta ?? {}), produtos } as EstoqueData;
  } catch (error) {
    console.error("Falha ao consultar estoque_terceiros no Postgres, usando snapshot do build:", error);
    return estoqueDataStatic;
  }
}

async function loadInsumosData(): Promise<InsumosData> {
  if (!isDbConfigured()) return insumosDataStatic;
  try {
    const [produtos, meta] = await Promise.all([queryRows("insumos_embalagens"), queryMeta("insumos_embalagens")]);
    return { ...(meta ?? {}), produtos } as InsumosData;
  } catch (error) {
    console.error("Falha ao consultar insumos_embalagens no Postgres, usando snapshot do build:", error);
    return insumosDataStatic;
  }
}

async function loadConsumoData(): Promise<ConsumoData> {
  // Consumo de insumos usa o JSON ja calculado pelo pipeline ODBC local confiavel
  // (automation/atualizar_dados.ps1). NAO usa o consumo_insumos.json bruto do Power
  // Automate: os valores de quantidade dessa fonte nao reconciliam com o pipeline confiavel
  // (~29x fora em produtos testados, provavelmente diferenca de unidade no modelo do Power
  // BI). Ver CLAUDE.md, 05/08/2026.
  if (!isDbConfigured()) return consumoDataStatic;
  try {
    const [produtos, meta] = await Promise.all([queryRows("consumo_insumos"), queryMeta("consumo_insumos")]);
    return { ...(meta ?? {}), produtos } as ConsumoData;
  } catch (error) {
    console.error("Falha ao consultar consumo_insumos no Postgres, usando snapshot do build:", error);
    return consumoDataStatic;
  }
}

async function loadMrpTerceirosData(): Promise<MrpTerceirosData> {
  // Plano de compra/producao por terceiro (Carteira, Plano x Real do mes, cortes), cruzado
  // por SKU com Estoque de terceiros. Fonte: pivot "Terceiro e Revenda" da planilha
  // "Projeto MRP compras remodelado v3 (5).xlsx". Ver CLAUDE.md, 12/08/2026.
  if (!isConfigured()) return mrpTerceirosDataStatic;
  try {
    return await fetchSharePointJson<MrpTerceirosData>("dados-mrp-terceiros.json");
  } catch (error) {
    console.error("Falha ao buscar dados-mrp-terceiros.json do SharePoint, usando snapshot do build:", error);
    return mrpTerceirosDataStatic;
  }
}

async function loadEscadinhaData(): Promise<EscadinhaData> {
  // Plano mestre de compras de todos os produtos (upload manual mensal). O desvio mes a mes
  // vem do historico proprio em escadinha/, calculado no extract_escadinha.py local. Ver
  // CLAUDE.md, 18/08/2026.
  if (!isDbConfigured()) return escadinhaDataStatic;
  try {
    const [produtos, desvios, meta] = await Promise.all([
      queryRows("escadinha_geral"),
      queryRows("escadinha_desvios"),
      queryMeta("escadinha"),
    ]);
    return { ...(meta ?? {}), produtos, desvios } as EscadinhaData;
  } catch (error) {
    console.error("Falha ao consultar escadinha no Postgres, usando snapshot do build:", error);
    return escadinhaDataStatic;
  }
}

async function loadEscadinhaInsumosData(): Promise<EscadinhaInsumosData> {
  // Escadinha de insumos: explosao BOM (ficha tecnica x plano de producao) mes a mes, por
  // (loja, insumo) - work/sheet-inspect/bom_explosion.py. Estrutura muito aninhada pra
  // quebrar em linhas - guardado como snapshot (objeto inteiro) no Postgres. Ver CLAUDE.md.
  if (!isDbConfigured()) return escadinhaInsumosDataStatic;
  try {
    return await querySnapshot<EscadinhaInsumosData>("escadinha_insumos_snapshot");
  } catch (error) {
    console.error("Falha ao consultar escadinha_insumos_snapshot no Postgres, usando snapshot do build:", error);
    return escadinhaInsumosDataStatic;
  }
}

async function loadPedidosVendaData(): Promise<PedidosVendaData> {
  // Estoque x Pedidos de venda pendentes por produto. "Pedido" e uma aproximacao: soma
  // pedidos de venda Fechado/Aguardando Separacao WMS ainda nao faturados. Ver CLAUDE.md,
  // 19/08/2026.
  if (!isDbConfigured()) return pedidosVendaDataStatic;
  try {
    const [produtos, meta] = await Promise.all([queryRows("pedidos_venda"), queryMeta("pedidos_venda")]);
    return { ...(meta ?? {}), produtos } as PedidosVendaData;
  } catch (error) {
    console.error("Falha ao consultar pedidos_venda no Postgres, usando snapshot do build:", error);
    return pedidosVendaDataStatic;
  }
}

async function loadCortesData(): Promise<CortesData> {
  // Corte do roteiro por produto/loja/dia (dados_cortes.json, Power Automate) cruzado com o
  // motivo preenchido manualmente em motivos_cortes.xlsx. Ver CLAUDE.md, 05/10/2026.
  if (!isDbConfigured()) return cortesDataStatic as CortesData;
  try {
    const [cortes, atendidos, meta] = await Promise.all([
      queryRows<CortesLinha>("cortes"),
      queryRows<AtendidoLinha>("cortes_atendidos"),
      queryMeta("cortes"),
    ]);
    const semMotivo = cortes.filter((c) => !c.motivo).length;
    return { ...(meta ?? {}), cortes, totalLinhas: cortes.length, semMotivo, atendidos } as CortesData;
  } catch (error) {
    console.error("Falha ao consultar cortes no Postgres, usando snapshot do build:", error);
    return cortesDataStatic as CortesData;
  }
}

async function loadValoresData(): Promise<ValoresData> {
  // Valor dos insumos - o Postgres ja guarda o resultado computado (mesma logica de
  // buildValorInsumos, rodada uma vez por ciclo de sincronizacao, nao a cada requisicao).
  if (!isDbConfigured()) return valoresDataStatic;
  try {
    return await querySnapshot<ValoresData>("valores_insumos_snapshot");
  } catch (error) {
    console.error("Falha ao consultar valores_insumos_snapshot no Postgres, usando snapshot do build:", error);
    return valoresDataStatic;
  }
}

async function loadValoresProdutoAcabadoData(): Promise<ValoresProdutoAcabadoData> {
  // Mesmo parametro de loadValoresData, so que cruzado com pedidos de venda (produto
  // acabado) em vez de insumos - ver app/lib/valor-produto-acabado.ts e
  // work/sheet-inspect/sync_postgres.mts (onde buildValorProdutoAcabado roda de fato agora).
  // Pedido do usuario em 21/08/2026.
  if (!isDbConfigured()) return valoresProdutoAcabadoDataStatic;
  try {
    return await querySnapshot<ValoresProdutoAcabadoData>("valores_produto_acabado_snapshot");
  } catch (error) {
    console.error("Falha ao consultar valores_produto_acabado_snapshot no Postgres, usando snapshot do build:", error);
    return valoresProdutoAcabadoDataStatic;
  }
}

async function loadFornecedoresData(): Promise<FornecedoresData> {
  // fornecedores_agregado.json ja vem pronto (agregado localmente por
  // work/sheet-inspect/build_fornecedores.py a partir de compras_produto.json, ~87 MB).
  // Pedido do usuario em 26/08/2026.
  if (!isDbConfigured()) return fornecedoresDataStatic;
  try {
    return await querySnapshot<FornecedoresData>("fornecedores_snapshot");
  } catch (error) {
    console.error("Falha ao consultar fornecedores_snapshot no Postgres, usando snapshot do build:", error);
    return fornecedoresDataStatic;
  }
}

async function loadCortesValoresData(): Promise<CortesValoresData> {
  // cortes_valores_agregado.json - mesmo esquema de fornecedores_agregado.json, gerado por
  // work/sheet-inspect/build_cortes.py. Financeiro (R$), senha, pedido do usuario em
  // 05/10/2026.
  if (!isDbConfigured()) return cortesValoresDataStatic;
  try {
    const [valores, valoresAtendidos, meta] = await Promise.all([
      queryRows<CortesValorLinha>("cortes_valores"),
      queryRows<AtendidoValorLinha>("cortes_valores_atendidos"),
      queryMeta("cortes_valores"),
    ]);
    return { ...(meta ?? {}), valores, valoresAtendidos } as CortesValoresData;
  } catch (error) {
    console.error("Falha ao consultar cortes_valores no Postgres, usando snapshot do build:", error);
    return cortesValoresDataStatic;
  }
}

function AcessoNaoAutorizado({ email }: { email: string }) {
  return (
    <main style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#f5f4f2" }}>
      <div style={{ background: "#fff", padding: "48px 40px", borderRadius: 16, boxShadow: "0 2px 24px rgba(0,0,0,0.08)", textAlign: "center", maxWidth: 420 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Acesso não liberado</h1>
        <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
          Sua conta (<strong>{email}</strong>) fez login com sucesso, mas ainda não está liberada
          pra ver nenhum menu do painel. Peça para um administrador liberar seu acesso em
          &quot;Administração&quot;, dentro do próprio painel.
        </p>
        <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
          <button type="submit" style={{ background: "#666", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, cursor: "pointer" }}>
            Sair
          </button>
        </form>
      </div>
    </main>
  );
}

// Login temporariamente OPCIONAL: o TI ainda nao cadastrou a URL de redirecionamento do
// App Registration, entao o callback do Microsoft Entra ID nao funciona ainda. Enquanto
// isso, a equipe usa o painel sem logar (so a visao operacional - sem "Valor dos insumos",
// que exige saber quem esta acessando). Trocar REQUIRE_LOGIN=true no .env.local (ou na
// hospedagem final) para reativar a exigencia de login sem tocar em mais nada. Ver CLAUDE.md.
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === "true";

export default async function Home() {
  const session = REQUIRE_LOGIN ? await auth() : null;
  if (REQUIRE_LOGIN && !session?.user?.email) {
    redirect("/login");
  }
  const email = session?.user?.email?.trim().toLocaleLowerCase("pt-BR") ?? null;

  const FINANCEIRAS: Section[] = ["valores", "valorProdutoAcabado", "fornecedores"];
  const { autorizado, permissoes, isAdmin, nome } = email
    ? await resolveAccess(email)
    : { autorizado: true, permissoes: SECTION_KEYS.filter((s) => !FINANCEIRAS.includes(s)), isAdmin: false, nome: null };
  if (!autorizado) {
    return <AcessoNaoAutorizado email={email!} />;
  }
  const nomeUsuario = nome?.trim() || email || "Equipe de Compras";
  const canViewValues = FINANCEIRAS.some((s) => permissoes.includes(s));

  const [estoqueData, insumosData, consumoData, mrpTerceirosData, escadinhaData, escadinhaInsumosData, pedidosVendaData, cortesData] = await Promise.all([
    loadEstoqueData(),
    loadInsumosData(),
    loadConsumoData(),
    loadMrpTerceirosData(),
    loadEscadinhaData(),
    loadEscadinhaInsumosData(),
    loadPedidosVendaData(),
    loadCortesData(),
  ]);
  // Validade (tempo de vida util padrao de cada produto) - catalogo digital da empresa,
  // transcrito manualmente (nao ha fonte automatica/SharePoint pra isso). Snapshot fixo no
  // repositorio (data/dados-validade.json), atualizado so quando o catalogo muda. Ver
  // conversa 30/10/2026.
  const validadeData: ValidadeData = validadeDataStatic;
  const valoresData = permissoes.includes("valores") ? await loadValoresData() : null;
  const valoresProdutoAcabadoData = permissoes.includes("valorProdutoAcabado") ? await loadValoresProdutoAcabadoData() : null;
  const fornecedoresData = permissoes.includes("fornecedores") ? await loadFornecedoresData() : null;
  const cortesValoresData = canViewValues ? await loadCortesValoresData() : null;

  return (
    <DashboardClient
      canViewValues={canViewValues}
      permissoes={permissoes}
      isAdmin={isAdmin}
      nomeUsuario={nomeUsuario}
      valoresData={valoresData}
      valoresProdutoAcabadoData={valoresProdutoAcabadoData}
      fornecedoresData={fornecedoresData}
      estoqueData={estoqueData}
      insumosData={insumosData}
      consumoData={consumoData}
      mrpTerceirosData={mrpTerceirosData}
      escadinhaData={escadinhaData}
      escadinhaInsumosData={escadinhaInsumosData}
      pedidosVendaData={pedidosVendaData}
      cortesData={cortesData}
      cortesValoresData={cortesValoresData}
      validadeData={validadeData}
    />
  );
}
