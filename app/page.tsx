import { redirect } from "next/navigation";
import { auth, signOut } from "../auth";
import DashboardClient from "./DashboardClient";
import estoqueDataStatic from "../public/dados-estoque.json";
import insumosDataStatic from "../public/dados-insumos.json";
import consumoDataStatic from "../public/dados-consumo-insumos.json";
import valoresDataStatic from "../data/dados-valores-insumos.json";
import mrpTerceirosDataStatic from "../public/dados-mrp-terceiros.json";
import escadinhaDataStatic from "../public/dados-escadinha.json";
import pedidosVendaDataStatic from "../public/dados-pedidos-venda.json";
import valoresProdutoAcabadoDataStatic from "../data/dados-valores-produto-acabado.json";
import { fetchSharePointJson, fetchAccessList, isConfigured, type AccessEntry } from "./lib/sharepoint";
import { buildValorInsumos, type ValorInsumosRow } from "./lib/valor-insumos";
import { buildValorProdutoAcabado } from "./lib/valor-produto-acabado";

export const dynamic = "force-dynamic";

type EstoqueData = typeof estoqueDataStatic;
type InsumosData = typeof insumosDataStatic;
type ConsumoData = typeof consumoDataStatic;
type ValoresData = typeof valoresDataStatic;
type MrpTerceirosData = typeof mrpTerceirosDataStatic;
type EscadinhaData = typeof escadinhaDataStatic;
type PedidosVendaData = typeof pedidosVendaDataStatic;
type ValoresProdutoAcabadoData = typeof valoresProdutoAcabadoDataStatic;

/**
 * Cada loadX tenta o SharePoint (dados atualizados 2x/dia pela automacao local +
 * Power Automate, independente desta maquina) e cai para o JSON estatico do build se o
 * Graph nao estiver configurado ou a busca falhar - o painel nunca fica fora do ar por
 * causa disso, so mostra dados potencialmente desatualizados. Ver CLAUDE.md.
 */
async function loadEstoqueData(): Promise<EstoqueData> {
  if (!isConfigured()) return estoqueDataStatic;
  try {
    return await fetchSharePointJson<EstoqueData>("dados-estoque.json");
  } catch (error) {
    console.error("Falha ao buscar dados-estoque.json do SharePoint, usando snapshot do build:", error);
    return estoqueDataStatic;
  }
}

async function loadInsumosData(): Promise<InsumosData> {
  if (!isConfigured()) return insumosDataStatic;
  try {
    return await fetchSharePointJson<InsumosData>("dados-insumos.json");
  } catch (error) {
    console.error("Falha ao buscar dados-insumos.json do SharePoint, usando snapshot do build:", error);
    return insumosDataStatic;
  }
}

async function loadConsumoData(): Promise<ConsumoData> {
  // Consumo de insumos usa o JSON ja calculado pelo pipeline ODBC local confiavel
  // (automation/atualizar_dados.ps1), copiado para o SharePoint. NAO usa o
  // consumo_insumos.json bruto do Power Automate: os valores de quantidade dessa fonte
  // nao reconciliam com o pipeline confiavel (~29x fora em produtos testados,
  // provavelmente diferenca de unidade no modelo do Power BI). Ver CLAUDE.md, 05/08/2026.
  if (!isConfigured()) return consumoDataStatic;
  try {
    return await fetchSharePointJson<ConsumoData>("dados-consumo-insumos.json");
  } catch (error) {
    console.error("Falha ao buscar dados-consumo-insumos.json do SharePoint, usando snapshot do build:", error);
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
  // Plano mestre de compras de todos os produtos (upload manual mensal, fora da subpasta de
  // extracao automatica). O arquivo de origem so guarda a revisao mais recente do plano - o
  // desvio mes a mes vem do historico proprio em escadinha/, calculado no extract_escadinha.py
  // local e publicado neste JSON. Ver CLAUDE.md, 18/08/2026.
  if (!isConfigured()) return escadinhaDataStatic;
  try {
    return await fetchSharePointJson<EscadinhaData>("dados-escadinha.json");
  } catch (error) {
    console.error("Falha ao buscar dados-escadinha.json do SharePoint, usando snapshot do build:", error);
    return escadinhaDataStatic;
  }
}

async function loadPedidosVendaData(): Promise<PedidosVendaData> {
  // Estoque x Pedidos de venda pendentes por produto (aba nova). "Pedido" e uma aproximacao:
  // soma pedidos de venda Fechado/Aguardando Separacao WMS ainda nao faturados, direto do
  // Postgres (build_pedidos_venda.py + extract_pedidos_venda_odbc.ps1) - nao reproduz o
  // filtro "tem talao" do relatorio Power BI original, que e uma medida DAX sem formula
  // visivel. Rodado sob demanda por enquanto, sem automacao agendada. Ver CLAUDE.md, 19/08/2026.
  if (!isConfigured()) return pedidosVendaDataStatic;
  try {
    return await fetchSharePointJson<PedidosVendaData>("dados-pedidos-venda.json");
  } catch (error) {
    console.error("Falha ao buscar dados-pedidos-venda.json do SharePoint, usando snapshot do build:", error);
    return pedidosVendaDataStatic;
  }
}

async function loadValoresData(insumosData: InsumosData): Promise<ValoresData> {
  if (!isConfigured()) return valoresDataStatic;
  try {
    const rawRows = await fetchSharePointJson<ValorInsumosRow[]>("valor_insumos.json");
    return buildValorInsumos(insumosData, rawRows) as ValoresData;
  } catch (error) {
    console.error("Falha ao buscar/processar valor_insumos.json do SharePoint, usando snapshot do build:", error);
    return valoresDataStatic;
  }
}

async function loadValoresProdutoAcabadoData(pedidosVendaData: PedidosVendaData, estoqueData: EstoqueData): Promise<ValoresProdutoAcabadoData> {
  // Mesmo valor_insumos.json de loadValoresData, so que cruzado com dados-pedidos-venda.json
  // (produto acabado) em vez de dados-insumos.json - ver app/lib/valor-produto-acabado.ts.
  // Pedido do usuario em 21/08/2026.
  if (!isConfigured()) return valoresProdutoAcabadoDataStatic;
  try {
    const rawRows = await fetchSharePointJson<ValorInsumosRow[]>("valor_insumos.json");
    return buildValorProdutoAcabado(pedidosVendaData, rawRows, estoqueData) as ValoresProdutoAcabadoData;
  } catch (error) {
    console.error("Falha ao buscar/processar valor_insumos.json (produto acabado) do SharePoint, usando snapshot do build:", error);
    return valoresProdutoAcabadoDataStatic;
  }
}

/**
 * Quem pode logar (qualquer conta Microsoft da empresa) e quem pode ver o que (lista
 * "AcessoPainelEstoques" no SharePoint) sao verificacoes separadas de proposito - login
 * prova identidade, a lista decide autorizacao. Se a lista nao puder ser lida (SharePoint
 * fora do ar), nao trava todo mundo por uma falha de infraestrutura: deixa ver a parte
 * operacional e nega so a parte financeira, registrando o erro.
 */
async function resolveAccess(email: string): Promise<{ autorizado: boolean; canViewValues: boolean; listaIndisponivel: boolean }> {
  if (!isConfigured()) {
    return { autorizado: true, canViewValues: false, listaIndisponivel: true };
  }
  let lista: AccessEntry[];
  try {
    lista = await fetchAccessList();
  } catch (error) {
    console.error("Falha ao ler a lista AcessoPainelEstoques do SharePoint:", error);
    return { autorizado: true, canViewValues: false, listaIndisponivel: true };
  }
  const entrada = lista.find((item) => item.email === email);
  if (!entrada || !entrada.ativo) {
    return { autorizado: false, canViewValues: false, listaIndisponivel: false };
  }
  return { autorizado: true, canViewValues: entrada.acessoValores, listaIndisponivel: false };
}

function AcessoNaoAutorizado({ email }: { email: string }) {
  return (
    <main style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#f5f4f2" }}>
      <div style={{ background: "#fff", padding: "48px 40px", borderRadius: 16, boxShadow: "0 2px 24px rgba(0,0,0,0.08)", textAlign: "center", maxWidth: 420 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Acesso não liberado</h1>
        <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
          Sua conta (<strong>{email}</strong>) fez login com sucesso, mas ainda não está na lista de
          acesso do painel. Peça para alguém da equipe adicionar seu e-mail na lista
          &quot;AcessoPainelEstoques&quot; no SharePoint.
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

  const { autorizado, canViewValues } = email
    ? await resolveAccess(email)
    : { autorizado: true, canViewValues: false };
  if (!autorizado) {
    return <AcessoNaoAutorizado email={email!} />;
  }

  const [estoqueData, insumosData, consumoData, mrpTerceirosData, escadinhaData, pedidosVendaData] = await Promise.all([
    loadEstoqueData(),
    loadInsumosData(),
    loadConsumoData(),
    loadMrpTerceirosData(),
    loadEscadinhaData(),
    loadPedidosVendaData(),
  ]);
  const valoresData = canViewValues ? await loadValoresData(insumosData) : null;
  const valoresProdutoAcabadoData = canViewValues ? await loadValoresProdutoAcabadoData(pedidosVendaData, estoqueData) : null;

  return (
    <DashboardClient
      canViewValues={canViewValues}
      valoresData={valoresData}
      valoresProdutoAcabadoData={valoresProdutoAcabadoData}
      estoqueData={estoqueData}
      insumosData={insumosData}
      consumoData={consumoData}
      mrpTerceirosData={mrpTerceirosData}
      escadinhaData={escadinhaData}
      pedidosVendaData={pedidosVendaData}
    />
  );
}
