"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type estoqueDataType from "../public/dados-estoque.json";
import type insumosDataType from "../public/dados-insumos.json";
import type consumoDataType from "../public/dados-consumo-insumos.json";
import type valoresDataType from "../data/dados-valores-insumos.json";
import type mrpTerceirosDataType from "../public/dados-mrp-terceiros.json";

type EstoqueData = typeof estoqueDataType;
type InsumosData = typeof insumosDataType;
type ConsumoData = typeof consumoDataType;
type MrpTerceirosData = typeof mrpTerceirosDataType;
type MrpTerceirosItem = MrpTerceirosData["produtos"][number];
// Tipo declarado a mao (nao inferido do JSON via "typeof ... import") porque "desvios" comeca
// vazio (so tem conteudo a partir da 2a revisao mensal do plano) - um array vazio no JSON faria
// o TypeScript inferir "never[]" e quebrar todo acesso a propriedade de EscadinhaDesvio.
type EscadinhaProduto = {
  cod: number | null;
  produto: string;
  origem: string | null;
  marca: string | null;
  categoria: string | null;
  unidade: string | null;
  plano?: number[];
  planoAnterior?: number[];
  real?: number[];
  cobertura?: number[];
};
type EscadinhaDesvio = {
  cod: number | null;
  produto: string;
  marca: string | null;
  categoria: string | null;
  unidade: string | null;
  mes: string;
  planoAnterior: number;
  planoAtual: number;
  desvio: number;
  desvioPercentual: number | null;
};
type EscadinhaData = {
  dataPublicacao: string;
  dataPublicacaoAnterior: string | null;
  produtos: EscadinhaProduto[];
  desvios: EscadinhaDesvio[];
};

type Status = "Falta crítica" | "Estoque baixo" | "Excesso" | "Nível ideal" | "Sob demanda";
type SourceProduct = InsumosData["produtos"][number];
type Product = SourceProduct & {
  status: Status;
  motivoStatus: string;
  leadTime: number | null;
  pontoPedido: number;
  estoqueProjetadoEntrega: number | null;
  estoqueMaximo: number;
  limiteExcesso: number;
  percentualAbaixoSeguranca: number | null;
};
type Section = "terceiros" | "insumos" | "consumo" | "valores" | "escadinha" | "pedidosVenda";
type PedidosVendaProduto = {
  cod: number;
  produto: string;
  categoria: string | null;
  loja: string;
  estoque: number;
  pedido: number;
  corte: number[];
  saldo: number;
  coberturaDias: number | null;
};
type PedidosVendaData = {
  atualizadoEm: string;
  mesesCorte: string[];
  produtos: PedidosVendaProduto[];
};
type ValuesData = typeof valoresDataType;
type ConsumptionItem = ConsumoData["produtos"][number];

const statusClass: Record<Status, string> = {
  "Falta crítica": "critical",
  "Estoque baixo": "risk",
  Excesso: "excess",
  "Nível ideal": "healthy",
  "Sob demanda": "ondemand",
};

function statusLabel(status: string) {
  return status === "Risco de falta" ? "Estoque baixo" : status;
}

function localDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isPastDelivery(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return localDate(value) < today;
}

function classifyInputType(productName: string, declaredType?: string) {
  const name = productName
    .toLocaleUpperCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (declaredType === "Matéria-prima" || /^MP(?:\s|[-–—])/.test(name)) return "Matéria-prima";
  if (name.includes("POUCH")) return "Saco pouch";
  if (name.startsWith("ETIQ") || name.includes("ROTULO")) return "Etiqueta";
  if (name.includes("CARTUCHO") || name.includes("CARTUXO")) return "Cartucho";
  if (name.includes("SACHE")) return "Etiqueta";
  if (name.includes("TAMPA")) return "Tampa";
  if (name.includes("BALDE SGF") || name.includes("BISNAGA") || name.includes("BALDE LISO OKKER 2.2") || name.includes("BALDE LISO OKKER 3.2")) return "Pote";
  if (name.includes("BOBINA")) return "Bobina";
  if (name.includes("SELO FECHA FACIL") || name.includes("SACO") || name.includes("FARDO") || name.includes("STRETCH")) return "Saco e stretch";
  if (name.includes("CAIXA")) return "Caixa";
  if (name.includes("POTE")) return "Pote";
  return "Outras embalagens";
}

function inputType(product: SourceProduct) {
  return classifyInputType(product.produto, product.tipo);
}

function isProductInativo(product: Pick<SourceProduct, "escadinha" | "consumoMensal" | "totalProgramado">) {
  return product.escadinha === 0 && product.consumoMensal === 0 && product.totalProgramado === 0;
}

/**
 * Produtos que o comprador confirmou terem saido de linha, mas que ainda nao zeraram
 * escadinha/consumo/entregas na planilha (por isso isProductInativo nao pega). Mantida
 * manualmente a pedido do usuario em 12/08/2026 - avisar aqui quando outro item sair de linha.
 */
const PRODUTOS_DESCONTINUADOS_MANUALMENTE = new Set([
  "OLEO DE COCO DA TERRINHA EX VIRGEM 200ML - FD 12",
  "OLEO DE COCO DA TERRINHA EX VIRGEM 500 ML - FD 6",
  "FARINHA ROSCA COOP 500 G FD 12",
  "SACO PLAST FUBA MIMOSO OBA 500 G",
  "SACO PLAST FAR MAND TORRADA OBA 500 G",
  "SACO PLAST MILHO PIPOCA OBA 500 G",
  // Marcados sem giro a pedido do usuario em 19/08/2026:
  "BOBINA TAPIOCA SAINT MARCHE 500 G",
  "ROTULO ALHO FRITO TERRINHA 250G",
  "ROTULO ALHO TRITURADO TERRINHA 200G",
  "MP - PREPARACAO FAROFA TRADICIONAL KG",
  "MP - COLORIFICO PO ESPECIAL KG",
  "BISNAGA SOPRADO OKKER 200G",
  "MP - PREPARACAO FAROFA ARTESANAL KG",
  "MP - FARINHA DE MANDIOCA CRUA FINA KG",
  "MP - FARINHA DE MANDIOCA TORRADA FINA KG",
  "ROTULO ALHO PASTA TERRINHA 400G",
  "SACO PLAST FARINHA MILHO AMAR OBA 250 G",
  "SACO PLAST FAR MAND CRUA GROSSA OBA  250 G",
  "BOBINA TAPIOCA BENASSI 500 G",
  "BOBINA FAROFA PRONTA PUBLIC TRADICIONAL 300G",
]);

/**
 * Igual a PRODUTOS_DESCONTINUADOS_MANUALMENTE, mas so pra loja especifica (chave loja|produto)
 * - o mesmo produto tem giro real em outras lojas (ex.: BOBINA PARA FARDOS 113 CM tem
 * escadinha/consumo normais na loja 2JM Amidos, so a loja 1 esta parada). Corrigido em
 * 19/08/2026 depois que marcar por nome apagou o giro real dessas outras lojas por engano.
 */
const PRODUTOS_DESCONTINUADOS_POR_LOJA = new Set([
  "1|BOBINA PARA FARDOS 113,0 CM LISO",
  "1|MP - ACIDO CITRICO KG",
  "1|MP - SAL REFINADO KG",
]);

/**
 * Produtos que isProductInativo classificaria como "sem giro" automaticamente (escadinha,
 * consumo e entregas todos zerados), mas que o comprador pediu para manter na analise normal
 * porque o estoque parado ainda e relevante (ex.: fardo de saco plastico com dezenas de
 * milhares de unidades). Chave loja+produto (nao so produto) porque o mesmo nome pode existir
 * em outra loja com estoque zerado, e esse caso deve continuar sem giro. Mantida manualmente a
 * pedido do usuario em 18/08/2026.
 */
const PRODUTOS_EM_ANALISE_MANUALMENTE = new Set([
  "14|SACO PLASTICO FARDO LISO 25 X 30  UNID",
  "14|SACO PLASTICO FARDO LISO 25 X 35 UNID",
  "14|SACO PLASTICO FARDO LISO 27 X 40 UNID",
]);

/**
 * Produtos comprados sob demanda (so quando ja existe pedido confirmado do cliente) -
 * nao faz sentido manter estoque de seguranca pra eles, entao "Falta critica"/"Excesso"
 * seriam alarme falso. Ficam visiveis na planilha principal normalmente, so com o status
 * neutro "Sob demanda" em vez de um alerta. Mantida manualmente a pedido do usuario em
 * 12/08/2026 - avisar aqui quando outro item passar a ser comprado sob demanda.
 */
const PRODUTOS_SOB_DEMANDA = new Set([
  "BATATA PALHA TRADICIONAL  PUBLIC 100 G - CX 20",
  "BATATA PALHA EXTRA FINA  PUBLIC 100 g - CX 20",
]);

/**
 * Igual a PRODUTOS_SOB_DEMANDA, mas so pra loja especifica (chave loja|produto) - o mesmo
 * produto (ex.: LOGISTICA - FILME STRETCH MANUAL) tem giro real na loja 1, so a loja 14 e sob
 * demanda. Pedido do usuario em 19/08/2026.
 */
const PRODUTOS_SOB_DEMANDA_POR_LOJA = new Set([
  "14|LOGISTICA - FILME STRETCH MANUAL 500x0,15 / 500x0,25",
  "14|SACO PLASTICO FARDO LISO 25 X 30  UNID",
  "14|SACO PLASTICO FARDO LISO 25 X 35 UNID",
  "14|SACO PLASTICO FARDO LISO 27 X 40 UNID",
]);

function isProductDescontinuado(product: SourceProduct, isInputs: boolean) {
  if (PRODUTOS_EM_ANALISE_MANUALMENTE.has(`${product.loja}|${product.produto}`)) return false;
  return (isInputs && isProductInativo(product))
    || PRODUTOS_DESCONTINUADOS_MANUALMENTE.has(product.produto)
    || PRODUTOS_DESCONTINUADOS_POR_LOJA.has(`${product.loja}|${product.produto}`);
}

const inputTypeOptions = [
  { value: "Matéria-prima", label: "Matérias-primas" },
  { value: "Bobina", label: "Bobinas" },
  { value: "Caixa", label: "Caixas" },
  { value: "Cartucho", label: "Cartuchos" },
  { value: "Pote", label: "Potes e baldes" },
  { value: "Saco pouch", label: "Sacos pouch" },
  { value: "Etiqueta", label: "Etiquetas, rótulos e sachês" },
  { value: "Saco e stretch", label: "Sacos, fardos e stretch" },
  { value: "Tampa", label: "Tampas" },
  { value: "Outras embalagens", label: "Outras embalagens" },
];

function typeOptionsFor(products: string[]) {
  const available = new Set(products);
  return inputTypeOptions.filter((option) => option.value !== "Outras embalagens" || available.has(option.value));
}

const packagingTypeValues = inputTypeOptions.filter((option) => option.value !== "Matéria-prima").map((option) => option.value);

/**
 * CMD (consumo médio diário) unificado: usa a mesma base que já sustenta a Segurança
 * (estoqueSeguranca ÷ seguranca), com fallback pro consumo mensal só quando a segurança não
 * estiver definida. Antes, Cobertura vinha direto da coluna da planilha, que podia usar uma
 * janela de cálculo diferente da Segurança e gerar contradição (ex.: 50 dias de cobertura
 * contra 20 dias/176cx de segurança, implicando dois CMDs diferentes pro mesmo produto).
 * Ver REGRAS_PAINEL_ESTOQUES.md — correção pedida pelo usuário em 12/08/2026.
 */
function dailyUseUnificado(source: SourceProduct): number {
  const daSeguranca = source.seguranca > 0 && source.estoqueSeguranca > 0 ? source.estoqueSeguranca / source.seguranca : 0;
  if (daSeguranca > 0) return daSeguranca;
  return source.consumoMensal > 0 ? source.consumoMensal / 30 : 0;
}

/**
 * Faixas do indice de cobertura (Cobertura Atual / Estoque de Seguranca x 100), reaproveitadas
 * tanto pelo calculo padrao (calculateVisualStatus) quanto pelo override que usa a Cobertura do
 * MRP para Terceiros (ver conversa 13/08/2026 - "cobertura desajustada de novo" - status/cor
 * agora sao recalculados a partir da mesma cobertura que aparece na tela, nunca de outra).
 */
function classifyCoverage(
  coberturaReal: number,
  seguranca: number,
  today: Date,
  firstDelivery: { data: string } | undefined,
): { status: Status; reason: string } {
  const indiceCobertura = seguranca > 0 ? (coberturaReal / seguranca) * 100 : null;
  const dataRuptura = new Date(today.getTime() + coberturaReal * 86400000);
  const entregaChegaATempo = firstDelivery != null && localDate(firstDelivery.data) <= dataRuptura;
  const indiceFmt = indiceCobertura == null ? "" : decimal.format(indiceCobertura);

  if (indiceCobertura == null) {
    return { status: "Nível ideal", reason: "Sem estoque de segurança configurado para este produto." };
  }
  if (indiceCobertura < 70) {
    if (entregaChegaATempo) {
      return {
        status: "Estoque baixo",
        reason: `Índice de cobertura em ${indiceFmt}% da segurança, mas a entrega de ${deliveryDate.format(localDate(firstDelivery!.data))} chega antes da ruptura prevista — sem risco real de falta.`,
      };
    }
    return {
      status: "Falta crítica",
      reason: firstDelivery
        ? `Índice de cobertura em ${indiceFmt}% da segurança; a entrega de ${deliveryDate.format(localDate(firstDelivery.data))} chega depois da ruptura prevista.`
        : `Índice de cobertura em ${indiceFmt}% da segurança, sem entrega programada.`,
    };
  }
  if (indiceCobertura < 90) {
    return { status: "Estoque baixo", reason: `Índice de cobertura em ${indiceFmt}% da segurança — abaixo da faixa ideal (90%-130%).` };
  }
  if (indiceCobertura <= 250) {
    return {
      status: "Nível ideal",
      reason: indiceCobertura <= 130
        ? `Índice de cobertura em ${indiceFmt}% da segurança — dentro da faixa ideal.`
        : `Índice de cobertura em ${indiceFmt}% da segurança — confortável, sem ação necessária.`,
    };
  }
  return {
    status: "Excesso",
    reason: firstDelivery
      ? `Índice de cobertura em ${indiceFmt}% da segurança, com entrega de ${deliveryDate.format(localDate(firstDelivery.data))} ainda programada — excesso crítico, avalie segurar o recebimento.`
      : `Índice de cobertura em ${indiceFmt}% da segurança, sem novas entregas programadas — o consumo deve normalizar.`,
  };
}

function calculateVisualStatus(source: SourceProduct): Product {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const futureDeliveries = source.entregasProgramadas
    .filter((item) => item.quantidade > 0 && localDate(item.data) >= today)
    .sort((a, b) => localDate(a.data).getTime() - localDate(b.data).getTime());
  const firstDelivery = futureDeliveries[0];
  const leadTime = firstDelivery ? Math.max(0, Math.round((localDate(firstDelivery.data).getTime() - today.getTime()) / 86400000)) : null;

  const dailyUse = dailyUseUnificado(source);
  const safetyStock = source.estoqueSeguranca > 0 ? source.estoqueSeguranca : dailyUse * source.seguranca;
  // Cobertura recalculada com o CMD unificado — substitui a coluna da planilha (fallback só
  // se não houver CMD nenhum, ex. produto sem consumo e sem segurança configurada).
  const coberturaReal = dailyUse > 0 ? source.estoque / dailyUse : source.cobertura;
  const projectedAtDelivery = leadTime == null ? null : source.estoque - dailyUse * leadTime;
  const reorderPoint = safetyStock + dailyUse * (leadTime ?? 0);
  const minimumLot = Math.max(0, source.loteMinimo);
  const maximumStock = safetyStock + minimumLot;
  const excessLimit = maximumStock + minimumLot * 0.2;
  const belowSafetyPercent = projectedAtDelivery == null || safetyStock <= 0 ? null : Math.max(0, ((safetyStock - projectedAtDelivery) / safetyStock) * 100);

  let status: Status;
  let reason: string;
  if (PRODUTOS_SOB_DEMANDA.has(source.produto) || PRODUTOS_SOB_DEMANDA_POR_LOJA.has(`${source.loja}|${source.produto}`)) {
    status = "Sob demanda";
    reason = "Compra sob demanda — só entra pedido quando já existe demanda confirmada do cliente, sem risco real de falta ou excesso.";
  } else {
    const classified = classifyCoverage(coberturaReal, source.seguranca, today, firstDelivery);
    status = classified.status;
    reason = classified.reason;
  }

  return {
    ...source,
    status,
    motivoStatus: reason,
    leadTime,
    pontoPedido: Math.round(reorderPoint),
    estoqueProjetadoEntrega: projectedAtDelivery == null ? null : Math.round(projectedAtDelivery),
    estoqueMaximo: Math.round(maximumStock),
    limiteExcesso: Math.round(excessLimit),
    percentualAbaixoSeguranca: belowSafetyPercent == null ? null : Math.round(belowSafetyPercent * 10) / 10,
    cobertura: Math.round(coberturaReal * 10) / 10,
  };
}

const number = new Intl.NumberFormat("pt-BR");
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const deliveryDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const deliveryColumnDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const deliveryDateLong = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "long" });
const deliveryMonth = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });
const monthLong = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const fullDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const MESES_ESCADINHA = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_ESCADINHA_LABEL: Record<string, string> = { jan: "Jan", fev: "Fev", mar: "Mar", abr: "Abr", mai: "Mai", jun: "Jun", jul: "Jul", ago: "Ago", set: "Set", out: "Out", nov: "Nov", dez: "Dez" };

function mesCorteLabel(mes: string) {
  const [ano, mesNum] = mes.split("-");
  return `${MESES_ESCADINHA_LABEL[MESES_ESCADINHA[Number(mesNum) - 1]]}/${ano.slice(2)}`;
}

function monthsAgoLabel(monthsAgo: number) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - monthsAgo);
  const label = monthLong.format(date);
  return label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1);
}

function performanceClass(value: number, projected: number) {
  if (projected <= 0) return "nodata";
  if (value < 85) return "low";
  if (value < 100) return "near";
  return "above";
}

function unitLabel(unit: string, value: number, compact = false) {
  if (unit === "kg") return "kg";
  if (unit === "cx") return "cx";
  return compact ? "un." : Math.abs(value) === 1 ? "unidade" : "unidades";
}

function MultiFilter({ label, options, selected, onChange }: { label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (values: string[]) => void }) {
  const [search, setSearch] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
        setSearch("");
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
        setSearch("");
      }
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const selectedLabel = selected.length === 0 ? "Todos" : selected.length === 1 ? options.find((option) => option.value === selected[0])?.label ?? selected[0] : `${selected.length} selecionados`;
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const visibleOptions = normalizedSearch ? options.filter((option) => option.label.toLocaleLowerCase("pt-BR").includes(normalizedSearch)) : options;
  return <div className={`multi-filter ${selected.length > 0 ? "has-selection" : ""}`}><span>{label}</span><details ref={detailsRef}><summary title={selectedLabel}>{selectedLabel}</summary><div className="multi-filter-menu">{options.length > 6 && <label className="multi-filter-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${label.toLocaleLowerCase("pt-BR")}...`} autoComplete="off" />{search && <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}>×</button>}</label>}<button type="button" className={selected.length === 0 ? "selected" : ""} onClick={() => onChange([])}><i>{selected.length === 0 ? "✓" : ""}</i>Todos</button>{visibleOptions.map((option) => { const checked = selected.includes(option.value); return <label className="multi-option" key={option.value} title={option.label}><input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((item) => item !== option.value) : [...selected, option.value])} /><i>✓</i><span>{option.label}</span></label>; })}{visibleOptions.length === 0 && <p className="multi-filter-empty">Nenhum resultado encontrado.</p>}</div></details></div>;
}

type ValueItem = ValuesData["produtos"][number];

const storeNames: Record<string, string> = {
  "1": "Da Terrinha - Matriz",
  "2": "J E Comércio",
  "6": "FFAMM Serviços Promocionais",
  "7": "Terrafec Fécula Mandioca",
  "10": "Okker - Matriz",
  "11": "2JM Amidos",
  "12": "Wrapioca",
  "14": "Da Terrinha - Filial SP",
  "15": "Terrafec Primavera",
  "17": "Okker - Filial",
};

function storeLabel(store: string) {
  return storeNames[store] ?? `Loja não identificada (código ${store})`;
}

function ValuesDashboard({
  onSectionChange,
  valoresData,
  insumosData,
  products,
  onProductsChange,
}: {
  onSectionChange: (section: Section) => void;
  valoresData: ValuesData;
  insumosData: InsumosData;
  products: string[];
  onProductsChange: (products: string[]) => void;
}) {
  const productsWithProjection = useMemo(
    () => new Set((insumosData.produtos as SourceProduct[]).filter((product) => product.escadinha > 0).map((product) => product.produto)),
    [insumosData],
  );
  const [query, setQuery] = useState("");
  const [quickCategories, setQuickCategories] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [priceStatus, setPriceStatus] = useState("Todos");
  const [sort, setSort] = useState("valor");
  const [limit, setLimit] = useState(18);
  const [notice, setNotice] = useState("");
  const [selectedValue, setSelectedValue] = useState<ValueItem | null>(null);
  const [highlightedValueKey, setHighlightedValueKey] = useState("");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const categoryCardsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function restoreCategoryViewOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && categoryCardsRef.current && !categoryCardsRef.current.contains(event.target)) {
        setQuickCategories([]);
        setLimit(18);
      }
    }
    document.addEventListener("pointerdown", restoreCategoryViewOnOutside);
    return () => document.removeEventListener("pointerdown", restoreCategoryViewOnOutside);
  }, []);

  const items = valoresData.produtos as ValueItem[];
  const availableTypeOptions = useMemo(() => typeOptionsFor(items.map((item) => item.categoria)), [items]);
  const categorySummary = useMemo(() => {
    const summarize = (categoryValues: string[]) => {
      const categoryItems = items.filter((item) => categoryValues.includes(item.categoria));
      return {
        itens: categoryItems.length,
        comPreco: categoryItems.filter((item) => item.precoAtual != null).length,
        valorEstoque: categoryItems.reduce((sum, item) => sum + (item.valorEstoque ?? 0), 0),
        valorEntregas: categoryItems.reduce((sum, item) => sum + (item.valorEntregas ?? 0), 0),
      };
    };
    return {
      embalagens: summarize(packagingTypeValues),
      materiasPrimas: summarize(["Matéria-prima"]),
    };
  }, [items]);
  const storeOptions = useMemo(() => Array.from(new Set(items.map((item) => item.loja))).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })), [items]);
  const supplierOptions = useMemo(() => Array.from(new Set(items.filter((item) => stores.length === 0 || stores.includes(item.loja)).map((item) => item.fornecedor))).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")), [items, stores]);
  const productOptions = useMemo(() => {
    const uniqueProducts = new Set(items
      .filter((item) => categories.length === 0 || categories.includes(item.categoria))
      .filter((item) => quickCategories.length === 0 || quickCategories.includes(item.categoria))
      .filter((item) => stores.length === 0 || stores.includes(item.loja))
      .filter((item) => suppliers.length === 0 || suppliers.includes(item.fornecedor))
      .map((item) => item.produto));
    return Array.from(uniqueProducts)
      .map((product) => ({ value: product, label: product }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [items, quickCategories, categories, stores, suppliers]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const result = items.filter((item) => (
      (!normalized || item.produto.toLocaleLowerCase("pt-BR").includes(normalized) || item.sku.includes(normalized) || item.fornecedor.toLocaleLowerCase("pt-BR").includes(normalized)) &&
      (quickCategories.length === 0 || quickCategories.includes(item.categoria)) &&
      (categories.length === 0 || categories.includes(item.categoria)) &&
      (stores.length === 0 || stores.includes(item.loja)) &&
      (suppliers.length === 0 || suppliers.includes(item.fornecedor)) &&
      (products.length === 0 || products.includes(item.produto)) &&
      (priceStatus === "Todos" || (priceStatus === "Com preço" ? item.precoAtual != null : item.precoAtual == null))
    ));
    return [...result].sort((a, b) => {
      const aWithoutProjection = !productsWithProjection.has(a.produto);
      const bWithoutProjection = !productsWithProjection.has(b.produto);
      if (aWithoutProjection !== bWithoutProjection) return aWithoutProjection ? 1 : -1;
      if (sort === "produto") return a.produto.localeCompare(b.produto, "pt-BR");
      if (sort === "estoque") return b.estoque - a.estoque;
      if (sort === "entregas") return (b.valorEntregas ?? -1) - (a.valorEntregas ?? -1);
      if (sort === "preco") return (b.precoAtual ?? -1) - (a.precoAtual ?? -1);
      if (sort === "preco-menor") return (a.precoAtual ?? Number.POSITIVE_INFINITY) - (b.precoAtual ?? Number.POSITIVE_INFINITY);
      return (b.valorEstoque ?? -1) - (a.valorEstoque ?? -1);
    });
  }, [items, query, quickCategories, categories, stores, suppliers, products, priceStatus, sort]);

  const visible = filtered;
  const totals = useMemo(() => ({
    valorEstoque: filtered.reduce((sum, item) => sum + (item.valorEstoque ?? 0), 0),
    valorEntregas: filtered.reduce((sum, item) => sum + (item.valorEntregas ?? 0), 0),
    valorAposEntregas: filtered.reduce((sum, item) => sum + (item.valorAposEntregas ?? 0), 0),
    semPreco: filtered.filter((item) => item.precoAtual == null).length,
  }), [filtered]);
  const monthlyDeliveries = useMemo(() => {
    const byMonth = new Map<string, { quantidade: number; valor: number; produtos: Set<string>; semValor: number }>();
    filtered.filter((item) => item.unidade === "kg").forEach((item) => item.entregasProgramadas.forEach((delivery) => {
      const date = localDate(delivery.data);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const entry = byMonth.get(key) ?? { quantidade: 0, valor: 0, produtos: new Set<string>(), semValor: 0 };
      entry.quantidade += delivery.quantidade;
      entry.valor += delivery.valor ?? 0;
      entry.produtos.add(`${item.loja}|${item.produto}`);
      if (delivery.valor == null) entry.semValor += 1;
      byMonth.set(key, entry);
    }));
    const totalQuantity = Array.from(byMonth.values()).reduce((sum, entry) => sum + entry.quantidade, 0);
    return Array.from(byMonth.entries())
      .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
      .map(([month, entry]) => ({
        mes: month,
        quantidade: entry.quantidade,
        valor: entry.valor,
        produtos: entry.produtos.size,
        semValor: entry.semValor,
        percentualKg: totalQuantity > 0 ? (entry.quantidade / totalQuantity) * 100 : 0,
        mediaKg: entry.quantidade > 0 ? entry.valor / entry.quantidade : 0,
      }));
  }, [filtered]);
  const totalScheduledKg = monthlyDeliveries.reduce((sum, month) => sum + month.quantidade, 0);
  const totalScheduledValue = monthlyDeliveries.reduce((sum, month) => sum + month.valor, 0);
  const averageScheduledKg = totalScheduledKg > 0 ? totalScheduledValue / totalScheduledKg : 0;
  const maxScheduledKg = Math.max(1, ...monthlyDeliveries.map((month) => month.quantidade));
  const selectedMonthDeliveries = useMemo(() => {
    if (!selectedMonth) return [];
    return filtered
      .flatMap((item) => item.entregasProgramadas
        .filter((delivery) => delivery.data.slice(0, 7) === selectedMonth)
        .map((delivery) => ({
          produto: item.produto,
          fornecedor: item.fornecedor,
          loja: item.loja,
          unidade: item.unidade,
          data: delivery.data,
          quantidade: delivery.quantidade,
          valor: delivery.valor,
        })))
      .sort((a, b) => a.data.localeCompare(b.data) || a.produto.localeCompare(b.produto, "pt-BR"));
  }, [filtered, selectedMonth]);
  const operationalBySku = useMemo(() => {
    const map = new Map<string, Product>();
    (insumosData.produtos as SourceProduct[]).forEach((source) => {
      const computed = calculateVisualStatus(source);
      map.set(`${source.loja}|${source.sku}`, computed);
      if (!map.has(source.sku)) map.set(source.sku, computed);
    });
    return map;
  }, [insumosData]);
  const coberturaFor = (item: ValueItem) => operationalBySku.get(`${item.loja}|${item.sku}`) ?? operationalBySku.get(item.sku) ?? null;
  const selectedOperational = useMemo(() => {
    if (!selectedValue) return null;
    return coberturaFor(selectedValue);
  }, [selectedValue, operationalBySku]);
  const updated = new Date(valoresData.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const referenceDate = valoresData.dataReferencia ? localDate(valoresData.dataReferencia).toLocaleDateString("pt-BR") : "não informada";

  function exportValues() {
    const header = ["Tipo", "SKU", "Produto", "Loja", "Fornecedor", "Estoque", "Unidade", "Custo contábil", "Valor em estoque", "Total programado", "Valor das entregas", "Valor após entregas", "Descrição no BI", "Relacionamento"];
    const rows = filtered.map((item) => [item.categoria, item.sku, item.produto, item.loja, item.fornecedor, item.estoque, item.unidade, item.precoAtual ?? "", item.valorEstoque ?? "", item.totalProgramado, item.valorEntregas ?? "", item.valorAposEntregas ?? "", item.descricaoBi ?? "", item.metodoRelacionamento ?? ""]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "valor-embalagens-materias-primas.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Relatório de valores exportado.");
    window.setTimeout(() => setNotice(""), 3000);
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><span>Da Terrinha<small>Planejamento de estoque</small></span></div>
      <nav aria-label="Navegação principal">
        <button className="nav-item" onClick={() => onSectionChange("terceiros")}><span>▦</span> Estoque de terceiros</button>
        <button className="nav-item" onClick={() => onSectionChange("insumos")}><span>▤</span> Embalagens e MP</button>
        <button className="nav-item" onClick={() => onSectionChange("consumo")}><span>◫</span> Consumo de insumos</button>
        <button className="nav-item" onClick={() => onSectionChange("escadinha")}><span>▧</span> Escadinha geral</button>
        <button className="nav-item" onClick={() => onSectionChange("pedidosVenda")}><span>⇄</span> Estoque x Pedidos</button>
        <button className="nav-item active" onClick={() => onSectionChange("valores")}><span>R$</span> Valor dos insumos</button>
      </nav>
      <div className="sidebar-note"><span className="pulse-dot" /><div><strong>Dados atualizados</strong><small>{updated}</small></div></div>
      <div className="profile"><span>CP</span><div><strong>Equipe de Compras</strong><small>Operação</small></div><i>···</i></div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><strong>Valor dos Insumos</strong></div>
        <label className="global-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(18); }} placeholder="Buscar embalagem, matéria-prima, SKU ou fornecedor..." /><kbd>Ctrl K</kbd></label>
        <div className="top-actions"><button className="primary-button" onClick={exportValues}><span>↓</span> Exportar valores</button></div>
      </header>
      <div className="content values-content">
        <div className="page-heading"><div><p className="eyebrow">VALORIZAÇÃO DO ESTOQUE</p><h1>Embalagens e Matérias-Primas</h1><p>Valor atual por loja e compromisso financeiro das próximas entregas.</p></div><button className="source-button" onClick={() => setNotice(`Custos do Power BI referentes ao último dia disponível: ${referenceDate}.`)}><span>↻</span><div><small>Data dos valores</small><strong>Power BI · {referenceDate}</strong></div></button></div>
        <section className="value-kpis" aria-label="Indicadores financeiros">
          <div className="value-kpi"><span>Estoque atual</span><strong>{currency.format(totals.valorEstoque)}</strong><small>Valor contábil informado no Power BI</small></div>
          <div className="value-kpi scheduled"><span>Entregas programadas</span><strong>{currency.format(totals.valorEntregas)}</strong><small>Pedidos futuros valorizados</small></div>
          <div className="value-kpi total"><span>Total após entregas</span><strong>{currency.format(totals.valorAposEntregas)}</strong><small>Estoque atual + próximas entradas</small></div>
          <button className="value-kpi missing" onClick={() => setPriceStatus("Sem preço")}><span>Custo não localizado</span><strong>{totals.semPreco}</strong><small>Entregas sem valorização financeira</small></button>
        </section>
        <section className="category-values" ref={categoryCardsRef}>
          <button className={packagingTypeValues.some((category) => quickCategories.includes(category)) ? "selected" : ""} onClick={() => { setQuickCategories(packagingTypeValues.some((category) => quickCategories.includes(category)) ? [] : packagingTypeValues); setLimit(18); }}><span>Embalagens<small>{categorySummary.embalagens.comPreco} de {categorySummary.embalagens.itens} com ficha contábil</small></span><strong>{currency.format(categorySummary.embalagens.valorEstoque)}</strong><em>+ {currency.format(categorySummary.embalagens.valorEntregas)} em entregas</em></button>
          <button className={quickCategories.includes("Matéria-prima") ? "selected" : ""} onClick={() => { setQuickCategories(quickCategories.includes("Matéria-prima") ? [] : ["Matéria-prima"]); setLimit(18); }}><span>Matérias-primas<small>{categorySummary.materiasPrimas.comPreco} de {categorySummary.materiasPrimas.itens} com ficha contábil</small></span><strong>{currency.format(categorySummary.materiasPrimas.valorEstoque)}</strong><em>+ {currency.format(categorySummary.materiasPrimas.valorEntregas)} em entregas</em></button>
        </section>
        <section className="inventory-panel values-panel">
          <div className="panel-heading"><div><h2>Composição dos valores</h2><p>{filtered.length} itens encontrados · {filtered.filter((item) => item.totalProgramado > 0).length} com entregas programadas</p></div></div>
          <div className="filters value-filters"><div className="selects">
            <MultiFilter label="Tipo" options={availableTypeOptions} selected={categories} onChange={(values) => { setCategories(values); onProductsChange([]); setLimit(18); }} />
            <MultiFilter label="Loja" options={storeOptions.map((item) => ({ value: item, label: storeLabel(item) }))} selected={stores} onChange={(values) => { setStores(values); setSuppliers([]); setLimit(18); }} />
            <MultiFilter label="Fornecedor" options={supplierOptions.map((item) => ({ value: item, label: item }))} selected={suppliers} onChange={(values) => { setSuppliers(values); onProductsChange([]); setLimit(18); }} />
            <MultiFilter label="Produto / material" options={productOptions} selected={products} onChange={(values) => { onProductsChange(values); setLimit(18); }} />
            <label>Custo<select value={priceStatus} onChange={(event) => { setPriceStatus(event.target.value); setLimit(18); }}><option>Todos</option><option>Com preço</option><option>Sem preço</option></select></label>
            <label>Ordenar<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="estoque">Maior estoque atual (quantidade)</option><option value="valor">Maior valor em estoque (R$)</option><option value="entregas">Maior valor de entregas (R$)</option><option value="preco">Maior custo contábil</option><option value="preco-menor">Menor custo contábil</option><option value="produto">Produto A–Z</option></select></label>
            {(categories.length > 0 || stores.length > 0 || suppliers.length > 0 || products.length > 0 || priceStatus !== "Todos") && <button type="button" className="clear-value-filters" onClick={() => { setCategories([]); setStores([]); setSuppliers([]); onProductsChange([]); setPriceStatus("Todos"); setLimit(18); }}>Limpar filtros</button>}
          </div></div>
          <div className="table-wrap values-table-wrap"><table className="values-table"><thead><tr><th>Produto / fornecedor</th><th>Estoque atual</th><th>Cobertura (dias)</th><th>Custo contábil</th><th>Valor em estoque</th><th>Próxima entrega</th><th>Total programado</th><th>Valor das entregas</th><th>Total após entregas</th></tr></thead><tbody>
            {visible.map((item) => { const next = item.entregasProgramadas[0]; const rowKey = `${item.categoria}-${item.loja}-${item.sku}-${item.produto}`; const operational = coberturaFor(item); return <tr key={rowKey} className={highlightedValueKey === rowKey ? "selected-row" : ""} onClick={() => { setHighlightedValueKey(rowKey); setSelectedValue(item); }}>
              <td><div className="product-cell"><div><strong title={item.produto}>{item.produto}</strong><small>SKU {item.sku} · Fornecedor: {item.fornecedor} · {storeLabel(item.loja)}</small></div></div></td>
              <td><strong className="numeric">{number.format(item.estoque)}</strong><small className="unit"> {item.unidade}</small></td>
              <td>{operational ? <strong>{number.format(Math.round(operational.cobertura))} dias</strong> : <span className="price-missing">—</span>}</td>
              <td>{item.precoAtual == null ? <span className="price-missing">Não localizado</span> : <><strong>{currency.format(item.precoAtual)}</strong><small className="unit"> / {item.unidade}</small></>}</td>
              <td>{item.valorEstoque == null ? <span className="price-missing">—</span> : <strong className="money-value">{currency.format(item.valorEstoque)}</strong>}</td>
              <td>{next ? <div className={`next-delivery ${isPastDelivery(next.data) ? "overdue-delivery" : ""}`}><strong>{deliveryColumnDate.format(new Date(next.data))}</strong><small>{number.format(next.quantidade)} {item.unidade}{next.valor != null && ` · ${currency.format(next.valor)}`}</small></div> : <span className="no-projection">Sem entrega</span>}</td>
              <td><strong>{number.format(item.totalProgramado)}</strong><small className="unit"> {item.unidade}</small></td>
              <td>{item.valorEntregas == null ? <span className="price-missing">—</span> : <strong className="money-value scheduled-money">{currency.format(item.valorEntregas)}</strong>}</td>
              <td>{item.valorAposEntregas == null ? <span className="price-missing">—</span> : <strong className="money-value total-money">{currency.format(item.valorAposEntregas)}</strong>}</td>
            </tr>; })}
          </tbody></table>{filtered.length === 0 && <div className="empty-state"><strong>Nenhum item encontrado</strong><p>Remova um filtro ou busque por outro termo.</p></div>}</div>
        </section>
        <section className="monthly-dashboard" aria-label="Gráfico mensal das próximas entradas">
          <div className="monthly-dashboard-heading"><div><p className="eyebrow">LINHA DO TEMPO DE ENTRADAS</p><h2>Entradas programadas mês a mês</h2><p>Quilos, participação percentual e valor médio pela ficha contábil de cada loja.</p></div><div className="monthly-dashboard-totals"><span><small>Total programado</small><strong>{number.format(totalScheduledKg)} kg</strong></span><span><small>Valor médio</small><strong>{currency.format(averageScheduledKg)} / kg</strong></span></div></div>
          {monthlyDeliveries.length > 0 ? <div className="monthly-bar-chart">
            {monthlyDeliveries.map((month) => {
              const [year, monthNumber] = month.mes.split("-").map(Number);
              return <button type="button" className={`monthly-bar-column ${selectedMonth === month.mes ? "selected" : ""}`} key={month.mes} onClick={() => setSelectedMonth(selectedMonth === month.mes ? null : month.mes)} aria-label={`Abrir projeções de ${deliveryMonth.format(new Date(year, monthNumber - 1, 1))}`}>
                <div className="bar-value"><strong>{number.format(month.quantidade)} kg</strong><span>{decimal.format(month.percentualKg)}%</span></div>
                <div className="bar-stage" title={`${number.format(month.quantidade)} kg · ${currency.format(month.valor)}`}>
                  <span style={{ height: `${Math.max(6, (month.quantidade / maxScheduledKg) * 100)}%` }} />
                </div>
                <strong className="bar-month">{deliveryMonth.format(new Date(year, monthNumber - 1, 1))}</strong>
                <small>{currency.format(month.mediaKg)} / kg</small>
                <small>{currency.format(month.valor)}</small>
                {month.semValor > 0 && <em>{month.semValor} sem custo</em>}
              </button>;
            })}
          </div> : <div className="empty-delivery-summary">Nenhuma entrada programada para os filtros selecionados.</div>}
          {selectedMonth && <div className="month-projection-detail">
            <div className="month-projection-heading"><div><small>PROJEÇÃO DO MÊS</small><h3>{deliveryMonth.format(localDate(`${selectedMonth}-01`))}</h3><p>{selectedMonthDeliveries.length} entradas programadas</p></div><button type="button" onClick={() => setSelectedMonth(null)} aria-label="Fechar projeções">×</button></div>
            <div className="month-projection-list">
              {selectedMonthDeliveries.map((delivery, index) => <div className="month-projection-row" key={`${delivery.loja}-${delivery.produto}-${delivery.data}-${index}`}>
                <div><strong>{delivery.produto}</strong><small>{storeLabel(delivery.loja)} · {delivery.fornecedor}</small></div>
                <span><small>Data</small><strong>{deliveryColumnDate.format(localDate(delivery.data))}</strong></span>
                <span><small>Quantidade</small><strong>{number.format(delivery.quantidade)} {delivery.unidade}</strong></span>
                <span><small>Valor</small><strong>{delivery.valor == null ? "Custo não localizado" : currency.format(delivery.valor)}</strong></span>
              </div>)}
              {selectedMonthDeliveries.length === 0 && <p className="monthly-empty">Nenhuma entrega encontrada para este mês.</p>}
            </div>
          </div>}
        </section>
        <footer>Estoque e custo contábil em {referenceDate}: {valoresData.origemEstoque} <span>•</span> Entregas: planilha de insumos valorizada pelo custo da respectiva loja. Itens sem correspondência segura permanecem identificados.</footer>
      </div>
    </section>
    {selectedValue && <div className="drawer-backdrop" onClick={() => setSelectedValue(null)}><aside className="drawer value-drawer" onClick={(event) => event.stopPropagation()}>
      <button className="drawer-close" onClick={() => setSelectedValue(null)}>×</button>
      <p className="eyebrow">DETALHE FINANCEIRO DO PRODUTO</p>
      <h2>{selectedValue.produto}</h2>
      <p className="drawer-sku">SKU {selectedValue.sku} · {storeLabel(selectedValue.loja)}</p>
      {selectedOperational ? <span className={`status-pill ${statusClass[selectedOperational.status]}`}><i />{statusLabel(selectedOperational.status)}</span> : <span className={`type-pill ${selectedValue.categoria === "Bobina" ? "bobina" : selectedValue.categoria === "Matéria-prima" ? "mp" : "packaging"}`}>{inputTypeOptions.find((option) => option.value === selectedValue.categoria)?.label ?? selectedValue.categoria}</span>}
      {selectedOperational && <>
        <div className="drawer-performance">
          <div><small>ATINGIMENTO DA ESCADINHA</small><strong className={performanceClass(selectedOperational.atingimento, selectedOperational.escadinha)}>{selectedOperational.escadinha > 0 ? `${decimal.format(selectedOperational.atingimento)}%` : "Sem projeção"}</strong></div>
          <div className="drawer-performance-bar"><span className={performanceClass(selectedOperational.atingimento, selectedOperational.escadinha)} style={{ width: `${Math.min(100, selectedOperational.atingimento)}%` }} /><i /></div>
          <p>{decimal.format(selectedOperational.faturado)} {unitLabel(selectedOperational.unidade, selectedOperational.faturado)} consumido de {decimal.format(selectedOperational.escadinha)} {unitLabel(selectedOperational.unidade, selectedOperational.escadinha)} projetado · desvio de {selectedOperational.desvioProjecao >= 0 ? "+" : ""}{decimal.format(selectedOperational.desvioProjecao)} {unitLabel(selectedOperational.unidade, selectedOperational.desvioProjecao)}</p>
        </div>
        <div className="drawer-metrics">
          <div><small>Projetado (Escadinha)</small><strong>{decimal.format(selectedOperational.escadinha)} {unitLabel(selectedOperational.unidade, selectedOperational.escadinha)}</strong></div>
          <div><small>Consumo realizado</small><strong>{decimal.format(selectedOperational.faturado)} {unitLabel(selectedOperational.unidade, selectedOperational.faturado)}</strong></div>
          <div><small>Estoque atual</small><strong>{number.format(selectedOperational.estoque)} {unitLabel(selectedOperational.unidade, selectedOperational.estoque)}</strong></div>
          <div><small>Cobertura</small><strong>{number.format(Math.round(selectedOperational.cobertura))} dias</strong></div>
          <div><small>Estoque de segurança</small><strong>{selectedOperational.seguranca} dias</strong></div>
          <div><small>Ponto de pedido</small><strong>{number.format(selectedOperational.pontoPedido)} {unitLabel(selectedOperational.unidade, selectedOperational.pontoPedido)}</strong></div>
          <div><small>Estoque projetado na entrega</small><strong>{selectedOperational.estoqueProjetadoEntrega == null ? "Sem entrega futura" : `${number.format(selectedOperational.estoqueProjetadoEntrega)} ${unitLabel(selectedOperational.unidade, selectedOperational.estoqueProjetadoEntrega)}`}</strong></div>
          <div><small>Limite de excesso</small><strong>{number.format(selectedOperational.limiteExcesso)} {unitLabel(selectedOperational.unidade, selectedOperational.limiteExcesso)}</strong></div>
          <div><small>Consumo mensal</small><strong>{number.format(selectedOperational.consumoMensal)} {unitLabel(selectedOperational.unidade, selectedOperational.consumoMensal)}</strong></div>
        </div>
      </>}
      <p className="drawer-section-label">VALORIZAÇÃO FINANCEIRA</p>
      <div className="drawer-metrics value-drawer-metrics">
        <div><small>Estoque atual</small><strong>{number.format(selectedValue.estoque)} {selectedValue.unidade}</strong></div>
        <div><small>Ficha contábil</small><strong>{selectedValue.precoAtual == null ? "Não localizada" : `${currency.format(selectedValue.precoAtual)} / ${selectedValue.unidade}`}</strong></div>
        <div><small>Valor em estoque</small><strong>{selectedValue.valorEstoque == null ? "Não localizado" : currency.format(selectedValue.valorEstoque)}</strong></div>
        <div><small>Total programado</small><strong>{number.format(selectedValue.totalProgramado)} {selectedValue.unidade}</strong></div>
        <div><small>Valor das entregas</small><strong>{selectedValue.valorEntregas == null ? "Sem ficha contábil" : currency.format(selectedValue.valorEntregas)}</strong></div>
        <div><small>Total após entregas</small><strong>{selectedValue.valorAposEntregas == null ? "Não calculado" : currency.format(selectedValue.valorAposEntregas)}</strong></div>
      </div>
      <section className="delivery-schedule value-delivery-schedule">
        <div className="schedule-heading"><div><small>AGENDA DE RECEBIMENTO</small><h3>Entregas programadas</h3></div><strong>{number.format(selectedValue.totalProgramado)} {selectedValue.unidade}</strong></div>
        {selectedValue.entregasProgramadas.length > 0 ? <div className="delivery-timeline">{selectedValue.entregasProgramadas.map((delivery, index) => <div className={`delivery-item value-delivery-item ${isPastDelivery(delivery.data) ? "overdue-delivery" : ""}`} key={`${delivery.data}-${index}`}>
          <span><i /></span>
          <div><strong>{deliveryDateLong.format(localDate(delivery.data))}</strong><small>{index === 0 ? "Próxima entrega" : `Entrega ${index + 1}`}</small></div>
          <b>{number.format(delivery.quantidade)} {selectedValue.unidade}<small>{delivery.valor == null ? "Sem ficha contábil" : currency.format(delivery.valor)}</small></b>
        </div>)}</div> : <div className="empty-schedule">Nenhuma entrega programada para este produto.</div>}
      </section>
      <div className="value-source-note"><small>FONTE DO VALOR</small><strong>Power BI · ficha contábil da {storeLabel(selectedValue.loja)}</strong><p>{selectedValue.descricaoBi ?? "Produto sem correspondência segura no relatório contábil."}</p></div>
    </aside></div>}
    {notice && <div className="toast"><span>✓</span>{notice}</div>}
  </main>;
}

function ConsumptionDashboard({
  onSectionChange,
  canViewValues,
  consumoData,
  insumosData,
  selectedProducts,
  onSelectedProductsChange,
  focusedKey,
  onFocusedKeyChange,
}: {
  onSectionChange: (section: Section) => void;
  canViewValues: boolean;
  consumoData: ConsumoData;
  insumosData: InsumosData;
  selectedProducts: string[];
  onSelectedProductsChange: (products: string[]) => void;
  focusedKey: string;
  onFocusedKeyChange: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [unitView, setUnitView] = useState<"kg" | "unidade">("kg");
  const barsRef = useRef<HTMLDivElement>(null);

  const items = consumoData.produtos as ConsumptionItem[];
  const allMonths = consumoData.meses as string[];
  const years = Array.from(new Set(allMonths.map((month) => month.slice(0, 4)))).sort((a, b) => b.localeCompare(a));
  const latestYear = years[0] ?? String(new Date().getFullYear());
  const [selectedYear, setSelectedYear] = useState(latestYear);
  const yearMonths = allMonths.filter((month) => month.startsWith(selectedYear));
  const [selectedMonth, setSelectedMonth] = useState("");
  useEffect(() => {
    function restoreYearTotalOnOutside(event: PointerEvent) {
      if (selectedMonth && event.target instanceof Node && barsRef.current && !barsRef.current.contains(event.target)) {
        setSelectedMonth("");
      }
    }
    document.addEventListener("pointerdown", restoreYearTotalOnOutside);
    return () => document.removeEventListener("pointerdown", restoreYearTotalOnOutside);
  }, [selectedMonth]);
  const storeOptions = useMemo(() => Array.from(new Set(items.map((item) => item.loja))).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })), [items]);
  const supplierOptions = useMemo(() => Array.from(new Set(items.filter((item) => stores.length === 0 || stores.includes(item.loja)).map((item) => item.fornecedor))).sort((a, b) => a.localeCompare(b, "pt-BR")), [items, stores]);
  const categoryOptions = useMemo(() => typeOptionsFor(Array.from(new Set(items.map((item) => classifyInputType(item.produto, item.tipo))))), [items]);
  const operationalMap = useMemo(() => new Map(
    (insumosData.produtos as SourceProduct[]).map((item) => [`${item.loja}|${item.sku}`, calculateVisualStatus(item)])
  ), []);
  const productOptions = useMemo(() => items
    .filter((item) => stores.length === 0 || stores.includes(item.loja))
    .filter((item) => suppliers.length === 0 || suppliers.includes(item.fornecedor))
    .filter((item) => categories.length === 0 || categories.includes(classifyInputType(item.produto, item.tipo)))
    .map((item) => ({ value: `${item.loja}|${item.sku}|${item.produto}`, label: item.produto }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")), [items, stores, suppliers, categories]);

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => {
      const key = `${item.loja}|${item.sku}|${item.produto}`;
      return (!search || item.produto.toLocaleLowerCase("pt-BR").includes(search) || item.sku.includes(search) || item.fornecedor.toLocaleLowerCase("pt-BR").includes(search))
        && (categories.length === 0 || categories.includes(classifyInputType(item.produto, item.tipo)))
        && (stores.length === 0 || stores.includes(item.loja))
        && (suppliers.length === 0 || suppliers.includes(item.fornecedor))
        && (selectedProducts.length === 0 || selectedProducts.includes(key));
    }).sort((a, b) => {
      const aMonth = a.historico.find((month) => month.mes === selectedMonth)?.consumoLiquido ?? 0;
      const bMonth = b.historico.find((month) => month.mes === selectedMonth)?.consumoLiquido ?? 0;
      return bMonth - aMonth || a.produto.localeCompare(b.produto, "pt-BR");
    });
  }, [items, query, categories, stores, suppliers, selectedProducts, selectedMonth]);

  const focused = filtered.find((item) => `${item.loja}|${item.sku}|${item.produto}` === focusedKey) ?? null;
  const effectiveUnitView = selectedProducts.length > 0 && filtered.length > 0
    ? (filtered[0].unidade === "kg" ? "kg" : "unidade")
    : unitView;
  const chartItems = focused ? [focused] : filtered.filter((item) => item.unidade === effectiveUnitView);
  const monthlyTotals = yearMonths.map((month) => ({
    mes: month,
    total: chartItems.reduce((sum, item) => sum + (item.historico.find((entry) => entry.mes === month)?.consumoLiquido ?? 0), 0),
    saida: chartItems.reduce((sum, item) => sum + (item.historico.find((entry) => entry.mes === month)?.saida ?? 0), 0),
    estorno: chartItems.reduce((sum, item) => sum + (item.historico.find((entry) => entry.mes === month)?.estorno ?? 0), 0),
  }));
  const maxMonth = Math.max(1, ...monthlyTotals.map((month) => month.total));
  const displayUnit = focused ? (focused.unidade === "kg" ? "kg" : "unidades") : (effectiveUnitView === "kg" ? "kg" : "unidades");
  const partialMonth = consumoData.periodoFim?.slice(0, 7) ?? "";
  const partialDay = consumoData.periodoFim ? localDate(consumoData.periodoFim).getDate() : 0;
  const showingAllMonths = selectedMonth === "";
  const currentMonthTotal = showingAllMonths
    ? monthlyTotals.reduce((sum, month) => sum + month.total, 0)
    : monthlyTotals.find((month) => month.mes === selectedMonth)?.total ?? 0;
  const monthPosition = yearMonths.indexOf(selectedMonth);
  const previousMonth = monthPosition > 0 ? monthlyTotals[monthPosition - 1] : null;
  const previousTotal = previousMonth?.total ?? 0;
  const monthChange = !showingAllMonths && previousTotal > 0 ? ((currentMonthTotal - previousTotal) / previousTotal) * 100 : null;
  const previousThreeMonths = showingAllMonths ? yearMonths : yearMonths.slice(Math.max(0, monthPosition - 3), monthPosition);
  const daysInSelectedMonth = selectedMonth ? new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate() : 30;
  const selectedIsPartial = selectedMonth === partialMonth && partialDay > 0 && partialDay < daysInSelectedMonth;
  const selectedMonthLabel = selectedMonth ? deliveryMonth.format(localDate(`${selectedMonth}-01`)) : `todos os meses de ${selectedYear}`;

  const actionRows = chartItems.map((item) => {
    const current = showingAllMonths
      ? item.historico.filter((month) => yearMonths.includes(month.mes)).reduce((sum, month) => sum + month.consumoLiquido, 0)
      : item.historico.find((month) => month.mes === selectedMonth)?.consumoLiquido ?? 0;
    const priorValues = previousThreeMonths.map((month) => item.historico.find((entry) => entry.mes === month)?.consumoLiquido ?? 0);
    const averageThree = priorValues.length ? priorValues.reduce((sum, value) => sum + value, 0) / priorValues.length : 0;
    const operational = operationalMap.get(`${item.loja}|${item.sku}`);
    const realized = operational?.faturado ?? 0;
    const variation = operational && operational.escadinha > 0
      ? ((realized - operational.escadinha) / operational.escadinha) * 100
      : null;
    const nextDelivery = operational?.entregasProgramadas
      .filter((delivery) => delivery.quantidade > 0 && localDate(delivery.data) >= new Date(new Date().setHours(0, 0, 0, 0)))
      .sort((a, b) => localDate(a.data).getTime() - localDate(b.data).getTime())[0];
    return { item, operational, current, realized, averageThree, variation, nextDelivery };
  }).sort((a, b) => b.realized - a.realized || b.current - a.current || a.item.produto.localeCompare(b.item.produto, "pt-BR"));
  const spikes = actionRows.filter((row) => row.variation != null && row.variation > 20).length;
  const withoutMovement = actionRows.filter((row) => row.realized === 0).length;
  const monthlyAverage = yearMonths.length > 0 ? currentMonthTotal / yearMonths.length : 0;
  const updated = new Date(consumoData.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><span>Da Terrinha<small>Planejamento de estoque</small></span></div>
      <nav aria-label="Navegação principal">
        <button className="nav-item" onClick={() => onSectionChange("terceiros")}><span>▦</span> Estoque de terceiros</button>
        <button className="nav-item" onClick={() => onSectionChange("insumos")}><span>▤</span> Embalagens e MP</button>
        <button className="nav-item active" onClick={() => onSectionChange("consumo")}><span>◫</span> Consumo de insumos</button>
        <button className="nav-item" onClick={() => onSectionChange("escadinha")}><span>▧</span> Escadinha geral</button>
        <button className="nav-item" onClick={() => onSectionChange("pedidosVenda")}><span>⇄</span> Estoque x Pedidos</button>
        {canViewValues && <button className="nav-item" onClick={() => onSectionChange("valores")}><span>R$</span> Valor dos insumos</button>}
      </nav>
      <div className="sidebar-note"><span className="pulse-dot" /><div><strong>Dados atualizados</strong><small>{updated}</small></div></div>
      <div className="profile"><span>CP</span><div><strong>Equipe de Compras</strong><small>Operação</small></div><i>···</i></div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><strong>Consumo de Insumos</strong></div>
        <label className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto, SKU ou fornecedor..." /><kbd>Ctrl K</kbd></label>
      </header>
      <div className="content consumption-content">
        <div className="page-heading"><div><p className="eyebrow">HISTÓRICO DE CONSUMO</p><h1>Consumo de Embalagens e Matérias-Primas</h1><p>Compare as saídas líquidas por produto, loja e mês.</p></div><div className="source-button static-source"><span>↻</span><div><small>Fonte atual</small><strong>Power BI · movimentos de produção</strong></div></div></div>

        <section className="consumption-summary">
          <div><span>{showingAllMonths ? `Consumo total de ${selectedYear}` : `Consumo em ${selectedMonthLabel}`}</span><strong>{number.format(currentMonthTotal)} {displayUnit}</strong><small>{showingAllMonths ? `${yearMonths.length} meses disponíveis` : selectedIsPartial ? `Parcial até ${String(partialDay).padStart(2, "0")}/${partialMonth.slice(5, 7)}` : "Mês fechado"}</small></div>
          <div><span>{showingAllMonths ? "Média mensal" : "Variação mensal"}</span><strong>{showingAllMonths ? `${number.format(monthlyAverage)} ${displayUnit}` : monthChange == null ? "—" : `${monthChange >= 0 ? "+" : ""}${decimal.format(monthChange)}%`}</strong><small>{showingAllMonths ? `Média dos meses de ${selectedYear}` : previousMonth ? `Comparado a ${deliveryMonth.format(localDate(`${previousMonth.mes}-01`))}` : "Sem mês anterior no ano"}</small></div>
          <div><span>{showingAllMonths ? "Produtos analisados" : "Acima da Escadinha"}</span><strong>{showingAllMonths ? actionRows.length : spikes}</strong><small>{showingAllMonths ? "Ordenados do maior para o menor realizado" : "Produtos com realizado mais de 20% acima da projeção"}</small></div>
          <div className="partial"><span>Sem realizado no mês</span><strong>{withoutMovement}</strong><small>Ficam no final da lista</small></div>
        </section>

        <section className="consumption-chart-card">
          <div className="consumption-chart-heading"><div><p className="eyebrow">EVOLUÇÃO MENSAL</p><h2>{focused ? focused.produto : `Consumo em ${displayUnit}`}</h2><p>{focused ? `${focused.lojaNome} · SKU ${focused.sku}` : "Clique em uma barra para selecionar o mês; clique fora para voltar ao total anual."}</p></div><div className="consumption-chart-actions"><label className="year-filter"><span>Ano</span><select value={selectedYear} onChange={(event) => { setSelectedYear(event.target.value); setSelectedMonth(""); }}><option value="" disabled>Selecione</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>{!focused && selectedProducts.length === 0 && <div className="unit-switch"><button className={effectiveUnitView === "kg" ? "active" : ""} onClick={() => setUnitView("kg")}>kg</button><button className={effectiveUnitView === "unidade" ? "active" : ""} onClick={() => setUnitView("unidade")}>unidades</button></div>}{focused && <button className="clear-focus" onClick={() => onFocusedKeyChange("")}>Voltar ao total</button>}</div></div>
          <div className="consumption-bars" ref={barsRef}>
            {monthlyTotals.map((month) => <button type="button" className={`consumption-bar ${selectedMonth === month.mes ? "selected" : ""}`} key={month.mes} onClick={() => setSelectedMonth(month.mes)} aria-pressed={selectedMonth === month.mes}>
              <div className="consumption-bar-value"><strong>{number.format(month.total)}</strong><small>{displayUnit}</small></div>
              <div className="consumption-bar-stage"><span style={{ height: `${Math.max(3, (month.total / maxMonth) * 100)}%` }} /></div>
              <strong>{deliveryMonth.format(localDate(`${month.mes}-01`))}</strong>
              <small>Saída {number.format(month.saida)} · Estorno {number.format(month.estorno)}</small>
              {month.mes === partialMonth && partialDay > 0 && <em>Parcial até dia {partialDay}</em>}
            </button>)}
          </div>
        </section>

        <section className="inventory-panel consumption-panel">
          <div className="panel-heading"><div><p className="eyebrow">ANÁLISE DO COMPRADOR</p><h2>{showingAllMonths ? `Análise de ${selectedYear}` : `Análise de ${selectedMonthLabel}`}</h2><p>Ordenado do maior para o menor realizado, com Escadinha, estoque, cobertura e próxima entrega.</p></div></div>
          <div className="filters value-filters"><div className="selects">
            <MultiFilter label="Categoria" options={categoryOptions} selected={categories} onChange={(values) => { setCategories(values); onSelectedProductsChange([]); onFocusedKeyChange(""); }} />
            <MultiFilter label="Loja" options={storeOptions.map((store) => ({ value: store, label: storeLabel(store) }))} selected={stores} onChange={(values) => { setStores(values); setSuppliers([]); onSelectedProductsChange([]); onFocusedKeyChange(""); }} />
            <MultiFilter label="Fornecedor" options={supplierOptions.map((supplier) => ({ value: supplier, label: supplier }))} selected={suppliers} onChange={(values) => { setSuppliers(values); onSelectedProductsChange([]); onFocusedKeyChange(""); }} />
            <MultiFilter label="Produto / material" options={productOptions} selected={selectedProducts} onChange={(values) => { const selectedItem = items.find((item) => values.includes(`${item.loja}|${item.sku}|${item.produto}`)); if (selectedItem) setUnitView(selectedItem.unidade === "kg" ? "kg" : "unidade"); onSelectedProductsChange(values); onFocusedKeyChange(""); }} />
            {(categories.length > 0 || stores.length > 0 || suppliers.length > 0 || selectedProducts.length > 0) && <button className="clear-value-filters" onClick={() => { setCategories([]); setStores([]); setSuppliers([]); onSelectedProductsChange([]); onFocusedKeyChange(""); }}>Limpar filtros</button>}
          </div></div>
          <div className="table-wrap consumption-table-wrap"><table className="consumption-table buyer-action-table"><thead><tr><th>Produto / fornecedor</th><th>Loja</th><th>Realizado do mês</th><th>Escadinha atual</th><th>{showingAllMonths ? "Média mensal" : "Média 3 meses"}</th><th>Variação vs. Escadinha</th><th>Estoque atual</th><th>Cobertura</th><th>Próxima entrega</th></tr></thead><tbody>
            {actionRows.map((row) => { const { item, operational } = row; const key = `${item.loja}|${item.sku}|${item.produto}`; return <tr key={key} className={focusedKey === key ? "selected-row" : ""} onClick={() => onFocusedKeyChange(focusedKey === key ? "" : key)}>
              <td><div className="product-cell"><div><strong title={item.produto}>{item.produto}</strong><small>SKU {item.sku} · {item.fornecedor}</small></div></div></td>
              <td>{storeLabel(item.loja)}</td>
              <td><strong>{number.format(row.realized)}</strong><small className="unit"> {item.unidade === "kg" ? "kg" : "un."}</small></td>
              <td>{operational ? <><strong>{number.format(operational.escadinha)}</strong><small className="unit"> {item.unidade === "kg" ? "kg" : "un."}</small></> : <span>—</span>}</td>
              <td><strong>{number.format(row.averageThree)}</strong><small className="unit"> {item.unidade === "kg" ? "kg" : "un."}</small></td>
              <td><strong className={row.variation != null && row.variation > 20 ? "trend-up" : row.variation != null && row.variation < -20 ? "trend-down" : ""}>{row.variation == null ? "—" : `${row.variation >= 0 ? "+" : ""}${decimal.format(row.variation)}%`}</strong></td>
              <td>{operational ? <><strong>{number.format(operational.estoque)}</strong><small className="unit"> {item.unidade === "kg" ? "kg" : "un."}</small></> : <span>—</span>}</td>
              <td>{operational ? <strong>{number.format(Math.round(operational.cobertura))} dias</strong> : <span>—</span>}</td>
              <td>{row.nextDelivery ? <><strong>{deliveryColumnDate.format(localDate(row.nextDelivery.data))}</strong><small>{number.format(row.nextDelivery.quantidade)} {item.unidade === "kg" ? "kg" : "un."}</small></> : <span>Sem entrega</span>}</td>
            </tr>; })}
          </tbody></table>{actionRows.length === 0 && <div className="empty-state"><strong>Nenhum produto encontrado</strong><p>Remova um filtro ou pesquise outro item.</p></div>}</div>
        </section>
        <footer>Fonte: {consumoData.origem} · Consumo líquido = saída para composição − estorno.</footer>
      </div>
    </section>
  </main>;
}

function EscadinhaDashboard({
  onSectionChange,
  canViewValues,
  escadinhaData,
}: {
  onSectionChange: (section: Section) => void;
  canViewValues: boolean;
  escadinhaData: EscadinhaData;
}) {
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);
  const [selected, setSelected] = useState<EscadinhaProduto | null>(null);
  const [semestre, setSemestre] = useState<1 | 2>(new Date().getMonth() < 6 ? 1 : 2);

  const produtos = escadinhaData.produtos as EscadinhaProduto[];
  const desvios = escadinhaData.desvios as EscadinhaDesvio[];
  const hasComparacao = escadinhaData.dataPublicacaoAnterior != null;
  const mesAtualIndex = new Date().getMonth();
  const mesAtual = MESES_ESCADINHA[mesAtualIndex];
  // Grade com os 12 meses ficava muito larga/poluida (pedido do usuario em 18/08/2026) -
  // mostra so o semestre selecionado; "Total anual" continua somando o ano inteiro.
  const mesesSemestre = semestre === 1 ? MESES_ESCADINHA.slice(0, 6) : MESES_ESCADINHA.slice(6, 12);
  const indiceMesesSemestre = semestre === 1 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];

  const categoryOptions = useMemo(
    () => Array.from(new Set(produtos.map((p) => p.categoria).filter((c): c is string => Boolean(c))))
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((c) => ({ value: c, label: c })),
    [produtos],
  );
  const productOptions = useMemo(
    () => produtos
      .filter((p) => categories.length === 0 || (p.categoria != null && categories.includes(p.categoria)))
      .map((p) => ({ value: p.produto, label: p.produto }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [produtos, categories],
  );

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("pt-BR");
    return produtos
      .filter((p) => (
        (!search || p.produto.toLocaleLowerCase("pt-BR").includes(search) || (p.cod != null && String(p.cod).includes(search)) || (p.marca ?? "").toLocaleLowerCase("pt-BR").includes(search))
        && (categories.length === 0 || (p.categoria != null && categories.includes(p.categoria)))
        && (selectedProdutos.length === 0 || selectedProdutos.includes(p.produto))
      ))
      .sort((a, b) => {
        if (hasComparacao) {
          const desvioA = totalDesvioAbsoluto(a);
          const desvioB = totalDesvioAbsoluto(b);
          if (desvioA !== desvioB) return desvioB - desvioA;
        }
        return a.produto.localeCompare(b.produto, "pt-BR");
      });
  }, [produtos, query, categories, selectedProdutos, hasComparacao]);

  function planoAnual(produto: EscadinhaProduto) {
    return (produto.plano ?? []).reduce((sum, value) => sum + (value ?? 0), 0);
  }
  function unitLabelEscadinha(produto: Pick<EscadinhaProduto, "unidade">) {
    return produto.unidade === "FD" ? "fardos" : "cx";
  }
  function totalDesvioAbsoluto(produto: EscadinhaProduto) {
    if (!produto.plano || !produto.planoAnterior) return 0;
    return produto.plano.reduce((sum, valor, index) => sum + Math.abs((valor ?? 0) - (produto.planoAnterior![index] ?? 0)), 0);
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><span>Da Terrinha<small>Planejamento de estoque</small></span></div>
      <nav aria-label="Navegação principal">
        <button className="nav-item" onClick={() => onSectionChange("terceiros")}><span>▦</span> Estoque de terceiros</button>
        <button className="nav-item" onClick={() => onSectionChange("insumos")}><span>▤</span> Embalagens e MP</button>
        <button className="nav-item" onClick={() => onSectionChange("consumo")}><span>◫</span> Consumo de insumos</button>
        <button className="nav-item active" onClick={() => onSectionChange("escadinha")}><span>▧</span> Escadinha geral</button>
        <button className="nav-item" onClick={() => onSectionChange("pedidosVenda")}><span>⇄</span> Estoque x Pedidos</button>
        {canViewValues && <button className="nav-item" onClick={() => onSectionChange("valores")}><span>R$</span> Valor dos insumos</button>}
      </nav>
      <div className="sidebar-note"><span className="pulse-dot" /><div><strong>Revisão do plano</strong><small>{fullDate.format(localDate(escadinhaData.dataPublicacao))}</small></div></div>
      <div className="profile"><span>CP</span><div><strong>Equipe de Compras</strong><small>Operação</small></div><i>···</i></div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><strong>Escadinha Geral</strong></div>
        <label className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto, código ou marca..." /><kbd>Ctrl K</kbd></label>
      </header>
      <div className="content consumption-content">
        <div className="page-heading"><div><p className="eyebrow">PLANO MESTRE DE COMPRAS</p><h1>Escadinha geral de produção</h1><p>Plano mês a mês de todos os produtos, atualizado a cada revisão mensal do plano mestre.</p></div><div className="source-button static-source"><span>↻</span><div><small>Fonte atual</small><strong>escadinha_compras.xlsx · upload mensal</strong></div></div></div>

        {!hasComparacao && <div className="empty-state" style={{ marginBottom: 24 }}>
          <strong>Primeira captura registrada em {fullDate.format(localDate(escadinhaData.dataPublicacao))}</strong>
          <p>Ainda não existe uma revisão anterior pra comparar. A partir da próxima vez que você subir uma versão nova de escadinha_compras.xlsx (com uma &quot;Data publicação&quot; diferente), esta tela passa a mostrar o desvio mês a mês de cada produto.</p>
        </div>}

        <section className="consumption-summary">
          <div><span>Produtos no plano</span><strong>{number.format(produtos.length)}</strong><small>Revisão de {fullDate.format(localDate(escadinhaData.dataPublicacao))}</small></div>
          {hasComparacao ? <>
            <div><span>Produtos com desvio</span><strong>{number.format(desvios.length)}</strong><small>Comparado à revisão de {fullDate.format(localDate(escadinhaData.dataPublicacaoAnterior as string))}</small></div>
            <div><span>Maior desvio absoluto</span><strong>{desvios[0] ? number.format(Math.abs(desvios[0].desvio)) : "—"}</strong><small>{desvios[0] ? `${desvios[0].produto} · ${MESES_ESCADINHA_LABEL[desvios[0].mes]}` : "Sem desvios"}</small></div>
          </> : <div><span>Comparação com revisão anterior</span><strong>—</strong><small>Disponível a partir da próxima revisão mensal</small></div>}
          <div className="partial"><span>Categorias no plano</span><strong>{categoryOptions.length}</strong><small>Filtre por categoria abaixo</small></div>
        </section>

        <section className="inventory-panel consumption-panel">
          <div className="panel-heading"><div><p className="eyebrow">PLANO MÊS A MÊS</p><h2>Escadinha de {new Date(escadinhaData.dataPublicacao).getUTCFullYear()}</h2><p>{hasComparacao ? "Ordenado do maior para o menor desvio total no ano; células destacadas mudaram desde a revisão anterior." : "Ordenado por produto — os meses que mudarem aparecem destacados a partir da próxima revisão."}</p></div><div className="unit-switch"><button className={semestre === 1 ? "active" : ""} onClick={() => setSemestre(1)}>1º semestre</button><button className={semestre === 2 ? "active" : ""} onClick={() => setSemestre(2)}>2º semestre</button></div></div>
          <div className="filters value-filters"><div className="selects">
            <MultiFilter label="Categoria" options={categoryOptions} selected={categories} onChange={(values) => { setCategories(values); setSelectedProdutos([]); }} />
            <MultiFilter label="Produto" options={productOptions} selected={selectedProdutos} onChange={setSelectedProdutos} />
            {(categories.length > 0 || selectedProdutos.length > 0) && <button className="clear-value-filters" onClick={() => { setCategories([]); setSelectedProdutos([]); }}>Limpar filtros</button>}
          </div></div>
          <div className="table-wrap consumption-table-wrap"><table className="consumption-table escadinha-grid"><thead><tr>
            <th>Produto / marca</th><th>Categoria</th>
            {mesesSemestre.map((mes) => <th key={mes} className={mes === mesAtual ? "escadinha-mes-atual" : ""}>{MESES_ESCADINHA_LABEL[mes]}</th>)}
            <th>Total anual</th>
          </tr></thead><tbody>
            {filtered.map((produto) => {
              return <tr key={produto.produto} className={selected?.produto === produto.produto ? "selected-row" : ""} onClick={() => setSelected(produto)}>
                <td><div className="product-cell"><div><strong title={produto.produto}>{produto.produto}</strong><small>Cód. {produto.cod ?? "—"} · {produto.marca ?? "Sem marca"}</small></div></div></td>
                <td>{produto.categoria ?? "—"}</td>
                {indiceMesesSemestre.map((index) => {
                  const mes = MESES_ESCADINHA[index];
                  const atual = produto.plano ? produto.plano[index] ?? 0 : null;
                  const anterior = produto.planoAnterior ? produto.planoAnterior[index] ?? 0 : null;
                  const mudou = hasComparacao && anterior != null && atual != null && anterior !== atual;
                  const diferenca = mudou ? (atual as number) - (anterior as number) : 0;
                  const percentual = mudou && anterior ? (diferenca / anterior) * 100 : null;
                  const real = produto.real && index <= mesAtualIndex ? produto.real[index] : null;
                  return <td key={mes} className={`${mes === mesAtual ? "escadinha-mes-atual" : ""} ${mudou ? (diferenca > 0 ? "escadinha-delta-up" : "escadinha-delta-down") : ""}`}>
                    {atual != null ? <strong className="numeric">{number.format(atual)}</strong> : <span className="no-projection">—</span>}
                    {mudou && <small className="unit">{diferenca > 0 ? "+" : ""}{number.format(diferenca)}{percentual != null && ` (${percentual > 0 ? "+" : ""}${decimal.format(percentual)}%)`}</small>}
                    {real != null && <small className="escadinha-real">Real: {number.format(real)}</small>}
                  </td>;
                })}
                <td><strong className="numeric">{number.format(planoAnual(produto))}</strong><small className="unit"> {unitLabelEscadinha(produto)}</small></td>
              </tr>;
            })}
          </tbody></table>{filtered.length === 0 && <div className="empty-state"><strong>Nenhum produto encontrado</strong><p>Remova um filtro ou pesquise outro item.</p></div>}</div>
        </section>
        <footer>Fonte: escadinha_compras.xlsx (upload mensal) · Células destacadas mudaram de valor desde a revisão anterior ({hasComparacao ? fullDate.format(localDate(escadinhaData.dataPublicacaoAnterior as string)) : "—"}).</footer>
      </div>
    </section>

    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}>
      <div className="drawer" onClick={(event) => event.stopPropagation()}>
        <button className="drawer-close" onClick={() => setSelected(null)}>×</button>
        <h2>{selected.produto}</h2>
        <p className="drawer-sku">Cód. {selected.cod ?? "—"} · {selected.marca ?? "Sem marca"} · {selected.categoria ?? "Sem categoria"}</p>
        {hasComparacao && <div className="value-source-note"><small>REVISÃO ANTERIOR</small><strong>{fullDate.format(localDate(escadinhaData.dataPublicacaoAnterior as string))}</strong><p>Total de desvio no ano: {number.format(totalDesvioAbsoluto(selected))} {unitLabelEscadinha(selected)} (soma das diferenças em módulo, mês a mês).</p></div>}
        <div className="table-wrap">
          <table className="consumption-table escadinha-drawer-table">
            <thead><tr><th>Mês</th><th>Plano{hasComparacao ? " (antes → agora)" : ""}</th><th>Real</th><th>% de atingimento</th></tr></thead>
            <tbody>
              {MESES_ESCADINHA.map((mes, index) => {
                const atual = selected.plano?.[index] ?? 0;
                const anterior = selected.planoAnterior?.[index] ?? 0;
                const mudou = hasComparacao && atual !== anterior;
                const diferenca = atual - anterior;
                const percentual = mudou && anterior ? (diferenca / anterior) * 100 : null;
                const real = selected.real?.[index] ?? 0;
                const atingimento = atual > 0 ? (real / atual) * 100 : null;
                return <tr key={mes} className={mudou ? "selected-row" : ""}>
                  <td>{MESES_ESCADINHA_LABEL[mes]}</td>
                  <td>
                    {mudou && <small className="unit">{number.format(anterior)} → </small>}
                    <strong className={`numeric ${mudou ? (diferenca > 0 ? "escadinha-delta-up" : "escadinha-delta-down") : ""}`}>{number.format(atual)}</strong>
                    {mudou && <small className="unit" style={{ display: "block", marginTop: 2 }}>{diferenca > 0 ? "+" : ""}{number.format(diferenca)}{percentual != null && ` (${percentual > 0 ? "+" : ""}${decimal.format(percentual)}%)`}</small>}
                  </td>
                  <td><strong className="numeric">{number.format(real)}</strong></td>
                  <td>{atingimento != null ? `${decimal.format(atingimento)}%` : "—"}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>}
  </main>;
}

function PedidosVendaDashboard({
  onSectionChange,
  canViewValues,
  pedidosVendaData,
}: {
  onSectionChange: (section: Section) => void;
  canViewValues: boolean;
  pedidosVendaData: PedidosVendaData;
}) {
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);

  const produtos = pedidosVendaData.produtos as PedidosVendaProduto[];
  const mesesCorte = pedidosVendaData.mesesCorte;

  const categoryOptions = useMemo(
    () => Array.from(new Set(produtos.map((p) => p.categoria).filter((c): c is string => Boolean(c))))
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((c) => ({ value: c, label: c })),
    [produtos],
  );
  const storeOptions = useMemo(
    () => Array.from(new Set(produtos.map((p) => p.loja).filter((l): l is string => Boolean(l))))
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((l) => ({ value: l, label: l })),
    [produtos],
  );
  const productOptions = useMemo(
    () => Array.from(new Set(produtos
      .filter((p) => categories.length === 0 || (p.categoria != null && categories.includes(p.categoria)))
      .map((p) => p.produto)))
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((p) => ({ value: p, label: p })),
    [produtos, categories],
  );

  const filtered = produtos.filter((p) => {
    if (categories.length > 0 && (p.categoria == null || !categories.includes(p.categoria))) return false;
    if (stores.length > 0 && !stores.includes(p.loja)) return false;
    if (selectedProdutos.length > 0 && !selectedProdutos.includes(p.produto)) return false;
    if (query && !p.produto.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  // Uma linha por loja (empresa do grupo: Matriz, FFAMM, Okker...) parecia produto duplicado
  // pro usuario - agrupa por produto somando as lojas que estao no filtro atual. Cobertura nao
  // e somavel direto (dias), entao reconstroi a taxa de venda diaria implicita por loja
  // (saldo/cobertura) pra agregar de forma correta. Pedido do usuario em 19/08/2026.
  const agrupados = useMemo(() => {
    const porCodigo = new Map<number, { produto: PedidosVendaProduto; lojas: Set<string>; taxaDiaria: number }>();
    for (const p of filtered) {
      const taxaDiaria = p.coberturaDias ? p.saldo / p.coberturaDias : 0;
      const atual = porCodigo.get(p.cod);
      if (!atual) {
        porCodigo.set(p.cod, { produto: { ...p }, lojas: new Set([p.loja]), taxaDiaria });
        continue;
      }
      atual.lojas.add(p.loja);
      atual.taxaDiaria += taxaDiaria;
      atual.produto.estoque += p.estoque;
      atual.produto.pedido += p.pedido;
      atual.produto.saldo += p.saldo;
      atual.produto.corte = atual.produto.corte.map((valor, index) => valor + p.corte[index]);
    }
    return Array.from(porCodigo.values()).map(({ produto, lojas, taxaDiaria }) => ({
      ...produto,
      loja: lojas.size === 1 ? Array.from(lojas)[0] : `${lojas.size} empresas`,
      coberturaDias: taxaDiaria !== 0 ? Math.round(produto.saldo / taxaDiaria) : null,
    })).sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
  }, [filtered]);

  const totalEstoque = agrupados.reduce((sum, p) => sum + p.estoque, 0);
  const totalPedido = agrupados.reduce((sum, p) => sum + p.pedido, 0);
  const totalCorte = agrupados.reduce((sum, p) => sum + p.corte.reduce((a, b) => a + b, 0), 0);
  const saldoNegativo = agrupados.filter((p) => p.saldo < 0).length;
  const updated = new Date(pedidosVendaData.atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><span>Da Terrinha<small>Planejamento de estoque</small></span></div>
      <nav aria-label="Navegação principal">
        <button className="nav-item" onClick={() => onSectionChange("terceiros")}><span>▦</span> Estoque de terceiros</button>
        <button className="nav-item" onClick={() => onSectionChange("insumos")}><span>▤</span> Embalagens e MP</button>
        <button className="nav-item" onClick={() => onSectionChange("consumo")}><span>◫</span> Consumo de insumos</button>
        <button className="nav-item" onClick={() => onSectionChange("escadinha")}><span>▧</span> Escadinha geral</button>
        <button className="nav-item active" onClick={() => onSectionChange("pedidosVenda")}><span>⇄</span> Estoque x Pedidos</button>
        {canViewValues && <button className="nav-item" onClick={() => onSectionChange("valores")}><span>R$</span> Valor dos insumos</button>}
      </nav>
      <div className="sidebar-note"><span className="pulse-dot" /><div><strong>Dados atualizados</strong><small>{updated}</small></div></div>
      <div className="profile"><span>CP</span><div><strong>Equipe de Compras</strong><small>Operação</small></div><i>···</i></div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><strong>Estoque x Pedidos</strong></div>
        <label className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto..." /><kbd>Ctrl K</kbd></label>
      </header>
      <div className="content consumption-content">
        <div className="page-heading"><div><p className="eyebrow">ESTOQUE X PEDIDOS DE VENDA</p><h1>Produto acabado</h1><p>Estoque, pedidos de venda pendentes e cobertura por produto.</p></div></div>

        <section className="kpi-grid" aria-label="Indicadores principais">
          <div className="kpi-card performance-card">
            <div className="kpi-top"><span className="kpi-icon">▤</span><span className="trend neutral">Filtrado</span></div>
            <strong>{number.format(agrupados.length)}</strong><p>Produtos monitorados</p><div className="mini-rule performance-rule"><span style={{ width: "100%" }} /></div>
            <small>{categories.length || stores.length || selectedProdutos.length ? "Com filtros aplicados" : "Todas as categorias e lojas"}</small>
          </div>
          <div className="kpi-card healthy-card">
            <div className="kpi-top"><span className="kpi-icon">▦</span><span className="trend good">Estoque</span></div>
            <strong>{number.format(Math.round(totalEstoque))}</strong><p>Estoque total</p><div className="mini-rule"><span style={{ width: "100%" }} /></div>
            <small>Soma das unidades filtradas</small>
          </div>
          <div className="kpi-card excess-card">
            <div className="kpi-top"><span className="kpi-icon">↑</span><span className="trend warn">Pendente</span></div>
            <strong>{number.format(Math.round(totalPedido))}</strong><p>Pedido total</p><div className="mini-rule"><span style={{ width: "100%" }} /></div>
            <small>Não faturado</small>
          </div>
          <div className="kpi-card critical-card">
            <div className="kpi-top"><span className="kpi-icon">✂</span><span className="trend critical">Últimos 3 meses</span></div>
            <strong>{number.format(Math.round(totalCorte))}</strong><p>Corte total</p><div className="mini-rule"><span style={{ width: "100%" }} /></div>
            <small>Cortado na entrega por falta de estoque</small>
          </div>
          <div className="kpi-card risk-card">
            <div className="kpi-top"><span className="kpi-icon">!</span><span className="trend bad">Atenção</span></div>
            <strong>{number.format(saldoNegativo)}</strong><p>Saldo negativo</p><div className="mini-rule"><span style={{ width: `${agrupados.length ? Math.round((saldoNegativo / agrupados.length) * 100) : 0}%` }} /></div>
            <small>Pedido maior que o estoque</small>
          </div>
        </section>

        <section className="inventory-panel consumption-panel">
          <div className="panel-heading"><div><p className="eyebrow">PRODUTOS</p><h2>Estoque, pedido e cobertura</h2><p>Ordenado por produto.</p></div></div>
          <div className="filters value-filters"><div className="selects">
            <MultiFilter label="Loja" options={storeOptions} selected={stores} onChange={setStores} />
            <MultiFilter label="Categoria" options={categoryOptions} selected={categories} onChange={(values) => { setCategories(values); setSelectedProdutos([]); }} />
            <MultiFilter label="Produto" options={productOptions} selected={selectedProdutos} onChange={setSelectedProdutos} />
            {(categories.length > 0 || stores.length > 0 || selectedProdutos.length > 0) && <button className="clear-value-filters" onClick={() => { setCategories([]); setStores([]); setSelectedProdutos([]); }}>Limpar filtros</button>}
          </div></div>
          <div className="table-wrap consumption-table-wrap"><table className="consumption-table pedidos-venda-table"><thead><tr>
            <th>Produto</th><th>Pedido</th><th>Estoque</th><th>Saldo</th><th>Cobertura</th>
            {mesesCorte.map((mes, index) => <th key={mes} style={index === 0 ? { borderLeft: "2px solid #c7d6cc" } : undefined}>Corte {mesCorteLabel(mes)}</th>)}
          </tr></thead><tbody>
            {agrupados.map((p) => <tr key={p.cod}>
              <td><div className="product-cell"><div><strong title={p.produto}>{p.produto}</strong><small>Cód. {p.cod} · {p.loja}</small><small>{p.categoria ?? "—"}</small></div></div></td>
              <td><strong className="numeric">{number.format(Math.round(p.pedido))}</strong></td>
              <td><strong className="numeric">{number.format(Math.round(p.estoque))}</strong></td>
              <td><strong className={`numeric ${p.saldo < 0 ? "escadinha-delta-down" : ""}`}>{number.format(Math.round(p.saldo))}</strong></td>
              <td>{p.coberturaDias != null ? <div className="coverage"><strong className={p.coberturaDias < 0 ? "escadinha-delta-down" : ""}>{number.format(p.coberturaDias)} dias</strong></div> : "—"}</td>
              {p.corte.map((valor, index) => <td key={mesesCorte[index]} style={index === 0 ? { borderLeft: "2px solid #c7d6cc" } : undefined}>{valor > 0 ? <strong className="numeric escadinha-delta-down">{number.format(Math.round(valor))}</strong> : <span className="no-projection">—</span>}</td>)}
            </tr>)}
          </tbody></table>{agrupados.length === 0 && <div className="empty-state"><strong>Nenhum produto encontrado</strong><p>Remova um filtro ou pesquise outro item.</p></div>}</div>
        </section>
        <footer>Fonte: produtos_estoque.json (Estoque, Pedido e Cobertura, Power Automate) + dados_cortes.json (Corte) · Atualização manual, sob demanda.</footer>
      </div>
    </section>
  </main>;
}

export default function DashboardClient({
  canViewValues,
  valoresData,
  estoqueData,
  insumosData,
  consumoData,
  mrpTerceirosData,
  escadinhaData,
  pedidosVendaData,
}: {
  canViewValues: boolean;
  valoresData: ValuesData | null;
  estoqueData: EstoqueData;
  insumosData: InsumosData;
  consumoData: ConsumoData;
  mrpTerceirosData: MrpTerceirosData;
  escadinhaData: EscadinhaData;
  pedidosVendaData: PedidosVendaData;
}) {
  const [section, setSection] = useState<Section>("terceiros");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"Todos" | Status>("Todos");
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [operationalProductSelections, setOperationalProductSelections] = useState({ terceiros: [] as string[], insumos: [] as string[] });
  const [consumptionSelectedProducts, setConsumptionSelectedProducts] = useState<string[]>([]);
  const [consumptionFocusedKey, setConsumptionFocusedKey] = useState("");
  const [valueSelectedProducts, setValueSelectedProducts] = useState<string[]>([]);
  const [safety, setSafety] = useState("Todos");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [performance, setPerformance] = useState<"Todos" | "Abaixo de 85%" | "De 85% a 99%" | "100% ou mais">("Todos");
  const [sort, setSort] = useState("urgencia");
  const [selected, setSelected] = useState<Product | null>(null);
  const [highlightedProductKey, setHighlightedProductKey] = useState("");
  const [notice, setNotice] = useState("");

  const isInputs = section === "insumos";
  const isConsumption = section === "consumo";
  const isValues = section === "valores";
  const isEscadinha = section === "escadinha";
  const isPedidosVenda = section === "pedidosVenda";
  const operationalSection = isInputs ? "insumos" : "terceiros";
  const selectedProducts = operationalProductSelections[operationalSection];
  function setSelectedProducts(values: string[]) {
    setOperationalProductSelections((current) => ({ ...current, [operationalSection]: values }));
  }
  const activeData = isInputs || isConsumption || isValues ? insumosData : estoqueData;
  const allProducts = useMemo(() => (activeData.produtos as SourceProduct[]).map(calculateVisualStatus), [activeData]);
  // Escadinha atual (Plano M), Real M, %Plano e Corte M - cruzados por SKU com a planilha
  // "Projeto MRP compras remodelado", a pedido do usuario em 12/08/2026. Estoque, Carteira,
  // Saldo e Cobertura NAO vem do MRP (risco de divergencia por filtro instavel da pivot) -
  // usam os campos nativos de dados-estoque.json (mesma fonte do Status/Cobertura de sempre).
  // Carteira = Estoque - Saldo. Ver conversa 17/08/2026.
  const mrpBySku = useMemo(
    () => new Map((mrpTerceirosData.produtos as MrpTerceirosItem[]).map((item) => [item.sku, item])),
    [mrpTerceirosData],
  );
  const [mostrarDescontinuados, setMostrarDescontinuados] = useState(false);
  // Itens descontinuados (sem projeção/consumo/entrega, ou marcados manualmente): nunca
  // contam nos indicadores de crítico/excesso nem entram nas abas de status — só aparecem
  // na tabela, com selo neutro, quando o comprador liga o filtro "Mostrar descontinuados".
  // A pedido do usuário em 12/08/2026.
  const products = useMemo(
    () => allProducts.filter((p) => !isProductDescontinuado(p, isInputs)),
    [allProducts, isInputs],
  );
  const descontinuados = useMemo(
    () => allProducts.filter((p) => isProductDescontinuado(p, isInputs)),
    [allProducts, isInputs],
  );
  const availableTypeOptions = useMemo(() => typeOptionsFor(products.map((product) => inputType(product))), [products]);
  const safetyOptions = useMemo(() => Array.from(new Set(products.map((product) => product.seguranca))).sort((a, b) => a - b), [products]);
  const stores = useMemo(() => Array.from(new Set(products.map((product) => product.loja))).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })), [products]);
  const suppliers = useMemo(
    () => Array.from(new Set(products.filter((product) => selectedStores.length === 0 || selectedStores.includes(product.loja)).map((product) => product.fornecedor))).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [products, selectedStores],
  );
  const productOptions = useMemo(
    () => products
      .filter((product) => selectedSuppliers.length === 0 || selectedSuppliers.includes(product.fornecedor))
      .filter((product) => selectedStores.length === 0 || selectedStores.includes(product.loja))
      .map((product) => ({ value: `${product.loja}|${product.sku}`, label: product.produto }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [products, selectedSuppliers, selectedStores],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const result = products.filter((product) => {
      const matchesQuery =
        !normalized ||
        product.produto.toLocaleLowerCase("pt-BR").includes(normalized) ||
        product.sku.includes(normalized) ||
        product.fornecedor.toLocaleLowerCase("pt-BR").includes(normalized);
      return (
        matchesQuery &&
        (selectedStores.length === 0 || selectedStores.includes(product.loja)) &&
        (selectedSuppliers.length === 0 || selectedSuppliers.includes(product.fornecedor)) &&
        (selectedTypes.length === 0 || selectedTypes.includes(inputType(product))) &&
        (selectedProducts.length === 0 || selectedProducts.includes(`${product.loja}|${product.sku}`)) &&
        (status === "Todos" || product.status === status) &&
        (safety === "Todos" || product.seguranca === Number(safety)) &&
        (performance === "Todos" ||
          (performance === "Abaixo de 85%" && product.escadinha > 0 && product.atingimento < 85) ||
          (performance === "De 85% a 99%" && product.atingimento >= 85 && product.atingimento < 100) ||
          (performance === "100% ou mais" && product.atingimento >= 100))
      );
    });

    return [...result].sort((a, b) => {
      const aSemProjecao = a.escadinha <= 0;
      const bSemProjecao = b.escadinha <= 0;
      if (aSemProjecao !== bSemProjecao) return aSemProjecao ? 1 : -1;
      const aSemConsumo = a.consumoMensal <= 0;
      const bSemConsumo = b.consumoMensal <= 0;
      if (aSemConsumo !== bSemConsumo) return aSemConsumo ? 1 : -1;
      if (sort === "cobertura") return a.cobertura - b.cobertura;
      if (sort === "produto") return a.produto.localeCompare(b.produto, "pt-BR");
      if (sort === "excesso") return b.cobertura - a.cobertura;
      if (sort === "atingimento") return a.atingimento - b.atingimento;
      const rank: Record<string, number> = { "Falta crítica": 0, "Estoque baixo": 1, "Nível ideal": 2, Excesso: 3, "Sob demanda": 4 };
      return rank[a.status] - rank[b.status] || a.cobertura - b.cobertura;
    });
  }, [products, query, selectedStores, selectedSuppliers, selectedProducts, status, safety, performance, sort, selectedTypes]);
  const descontinuadosFiltered = useMemo(() => {
    if (!mostrarDescontinuados) return [];
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return descontinuados
      .filter((product) => (
        (!normalized || product.produto.toLocaleLowerCase("pt-BR").includes(normalized) || product.sku.includes(normalized) || product.fornecedor.toLocaleLowerCase("pt-BR").includes(normalized)) &&
        (selectedStores.length === 0 || selectedStores.includes(product.loja)) &&
        (selectedSuppliers.length === 0 || selectedSuppliers.includes(product.fornecedor)) &&
        (selectedTypes.length === 0 || selectedTypes.includes(inputType(product))) &&
        (selectedProducts.length === 0 || selectedProducts.includes(`${product.loja}|${product.sku}`))
      ))
      .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
  }, [descontinuados, mostrarDescontinuados, query, selectedStores, selectedSuppliers, selectedTypes, selectedProducts]);
  const scheduleDates = useMemo(
    () => Array.from(new Set(filtered.flatMap((product) => product.entregasProgramadas.filter((item) => item.quantidade > 0).map((item) => item.data)))).sort(),
    [filtered],
  );

  const critical = products.filter((p) => p.status === "Falta crítica");
  const risk = products.filter((p) => p.status === "Estoque baixo");
  const excess = products.filter((p) => p.status === "Excesso");
  const healthy = products.filter((p) => p.status === "Nível ideal");
  const attention = [...critical, ...risk];
  const suggestedUnits = attention.reduce((sum, p) => sum + p.sugestaoCompra, 0);
  const excessUnits = excess.reduce((sum, p) => sum + Math.max(0, p.estoque - p.limiteExcesso), 0);
  const projectedTotal = products.reduce((sum, p) => sum + p.escadinha, 0);
  const soldTotal = products.reduce((sum, p) => sum + p.faturado, 0);
  const portfolioAttainment = projectedTotal > 0 ? (soldTotal / projectedTotal) * 100 : 0;
  const belowTarget = products.filter((p) => p.escadinha > 0 && p.atingimento < 85).length;
  const scheduledDeliveries = products.reduce((sum, p) => sum + p.entregasProgramadas.length, 0);
  const scheduledUnits = products.reduce((sum, p) => sum + p.totalProgramado, 0);

  function changeSection(nextSection: Section) {
    if (nextSection === "valores" && !canViewValues) return;
    setSection(nextSection);
    setQuery("");
    setStatus("Todos");
    setSelectedStores([]);
    setSelectedSuppliers([]);
    setSafety("Todos");
    setPerformance("Todos");
    setSelectedTypes([]);
    setSelected(null);
  }

  function exportCsv() {
    const header = ["SKU", "Produto", "Fornecedor", "Unidade de medida", "Escadinha projetada", "Faturado", "Atingimento %", "Desvio", "Estoque", "Cobertura", "Segurança", "Status", ...scheduleDates.map((date) => `Entrega ${new Date(date).toLocaleDateString("pt-BR")}`), "Total programado", "Sugestão de compra"];
    const rows = filtered.map((p) => {
      const deliveries = new Map(p.entregasProgramadas.map((item) => [item.data, item.quantidade]));
      return [p.sku, p.produto, p.fornecedor, p.unidade, p.escadinha, p.faturado, p.atingimento, p.desvioProjecao, p.estoque, p.cobertura, p.seguranca, statusLabel(p.status), ...scheduleDates.map((date) => deliveries.get(date) ?? ""), p.totalProgramado, p.sugestaoCompra];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = isInputs ? "plano-embalagens-materia-prima.csv" : "plano-estoque-terceiros.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Plano exportado com os filtros atuais.");
    window.setTimeout(() => setNotice(""), 3000);
  }

  const updated = new Date(activeData.atualizadoEm).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isValues && valoresData) return <ValuesDashboard onSectionChange={changeSection} valoresData={valoresData} insumosData={insumosData} products={valueSelectedProducts} onProductsChange={setValueSelectedProducts} />;
  if (isConsumption) return <ConsumptionDashboard onSectionChange={changeSection} canViewValues={canViewValues} consumoData={consumoData} insumosData={insumosData} selectedProducts={consumptionSelectedProducts} onSelectedProductsChange={setConsumptionSelectedProducts} focusedKey={consumptionFocusedKey} onFocusedKeyChange={setConsumptionFocusedKey} />;
  if (isEscadinha) return <EscadinhaDashboard onSectionChange={changeSection} canViewValues={canViewValues} escadinhaData={escadinhaData} />;
  if (isPedidosVenda) return <PedidosVendaDashboard onSectionChange={changeSection} canViewValues={canViewValues} pedidosVendaData={pedidosVendaData} />;

  function renderProductRow(product: Product, descontinuado: boolean) {
    const cls = statusClass[product.status as Status];
    const performance = performanceClass(product.atingimento, product.escadinha);
    const deliveries = new Map(product.entregasProgramadas.map((item) => [item.data, item.quantidade]));
    const bar = Math.min(100, Math.max(4, (product.cobertura / Math.max(product.seguranca * 1.7, product.cobertura)) * 100));
    const rowKey = `${product.loja}-${product.sku}-${product.produto}`;
    const mrp = !isInputs ? mrpBySku.get(product.sku) : undefined;
    const mrpQty = (value: number | null | undefined) => (value == null ? <span className="no-projection">—</span> : <strong className="numeric">{number.format(Math.round(value))}</strong>);
    return <tr key={rowKey} className={highlightedProductKey === rowKey ? "selected-row" : ""} onClick={() => { setHighlightedProductKey(rowKey); setSelected(product); }}>
      <td data-label={isInputs ? "Produto / loja" : "Produto / fornecedor"}><div className="product-cell"><div><strong>{product.produto}</strong><small>SKU {product.sku} · {isInputs ? storeLabel(product.loja) : `Fornecedor: ${product.fornecedor}`}</small></div></div></td>
      {isInputs ? (
        <>
          <td data-label="Escadinha projetada">{product.escadinha > 0 ? <><strong className="numeric">{decimal.format(product.escadinha)}</strong><small className="unit"> {unitLabel(product.unidade, product.escadinha, true)}</small></> : <span className="no-projection">Sem projeção</span>}</td>
          <td data-label="Consumo realizado"><strong className="numeric">{decimal.format(product.faturado)}</strong><small className="unit"> {unitLabel(product.unidade, product.faturado, true)}</small></td>
          <td data-label="Atingimento">{product.escadinha > 0 ? <div className="performance-cell"><div><strong className={performance}>{decimal.format(product.atingimento)}%</strong><small>{product.desvioProjecao >= 0 ? "+" : ""}{decimal.format(product.desvioProjecao)} {unitLabel(product.unidade, product.desvioProjecao, true)}</small></div><div className="sales-track"><span className={performance} style={{ width: `${Math.min(100, product.atingimento)}%` }} /><i /></div></div> : <span className="no-projection">—</span>}</td>
          <td data-label="Estoque"><strong className="numeric">{number.format(product.estoque)}</strong><small className="unit"> {unitLabel(product.unidade, product.estoque, true)}</small></td>
          <td data-label="Cobertura">{descontinuado ? <span className="no-projection">—</span> : <div className="coverage"><strong>{number.format(Math.round(product.cobertura))} dias</strong><small className="unit">Segurança: {product.seguranca} dias</small><div><span className={cls} style={{ width: `${bar}%` }} /></div></div>}</td>
        </>
      ) : (
        <>
          <td data-label="Estoque"><strong className="numeric">{number.format(product.estoque)}</strong><small className="unit"> {unitLabel(product.unidade, product.estoque, true)}</small></td>
          <td data-label="Carteira">{mrpQty(product.estoque - product.saldo)}</td>
          <td data-label="Saldo">{mrpQty(product.saldo)}</td>
          <td data-label="Cobertura">{descontinuado ? <span className="no-projection">—</span> : <div className="coverage"><strong>{number.format(Math.round(product.cobertura))} dias</strong><small className="unit">Segurança: {product.seguranca} dias</small><div><span className={cls} style={{ width: `${bar}%` }} /></div></div>}</td>
          <td data-label="Escadinha atual">{mrpQty(mrp?.planoMes ?? (product.escadinha > 0 ? product.escadinha : null))}</td>
          <td data-label="Real M">{mrpQty(mrp?.realMes ?? (product.faturado > 0 ? product.faturado : null))}</td>
          <td data-label="%Plano">{mrp?.percentualPlano != null ? <strong className="numeric">{decimal.format(mrp.percentualPlano * 100)}%</strong> : product.escadinha > 0 ? <strong className="numeric">{decimal.format(product.atingimento)}%</strong> : <span className="no-projection">—</span>}</td>
          <td data-label="Corte M">{mrpQty(mrp?.corteMes)}</td>
        </>
      )}
      <td data-label="Status" title={descontinuado ? "Sem projeção, consumo recente ou entrega programada — não conta nos indicadores de crítico/excesso." : product.motivoStatus}>{descontinuado ? <span className="no-projection">Sem giro</span> : <span className={`status-pill ${cls}`}><i />{statusLabel(product.status)}</span>}</td>
      {scheduleDates.map((date, index) => {
        const quantity = deliveries.get(date);
        const overdue = isPastDelivery(date);
        return <td key={date} data-label={`Entrega ${deliveryColumnDate.format(new Date(date))}`} className={`delivery-date-cell ${index === 0 ? "delivery-block-start" : ""} ${quantity ? "has-delivery" : "no-delivery-date"} ${overdue ? "overdue-delivery" : ""}`}>{quantity ? <><strong>{number.format(quantity)}</strong><small> {unitLabel(product.unidade, quantity, true)}</small></> : <span>—</span>}</td>;
      })}
      <td data-label="Total programado" className="delivery-total-cell delivery-block-end">{product.totalProgramado > 0 ? <><strong>{number.format(product.totalProgramado)}</strong><small> {unitLabel(product.unidade, product.totalProgramado, true)}</small></> : <span>—</span>}</td>
      <td><button className="row-action" aria-label={`Ver detalhes de ${product.produto}`}>›</button></td>
    </tr>;
  }

  const selectedMrp = selected && !isInputs ? mrpBySku.get(selected.sku) : undefined;
  const selectedMonthlyValues = selectedMrp ? [selectedMrp.realMes1, selectedMrp.realMes2, selectedMrp.realMes3].filter((v): v is number => v != null) : [];
  const selectedMonthlyAvg = selectedMonthlyValues.length > 0 ? selectedMonthlyValues.reduce((a, b) => a + b, 0) / selectedMonthlyValues.length : selected?.consumoMensal ?? 0;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span>
          <span>Da Terrinha<small>Planejamento de estoque</small></span>
        </div>
        <nav aria-label="Navegação principal">
          <button className={`nav-item ${section === "terceiros" ? "active" : ""}`} onClick={() => changeSection("terceiros")}><span>▦</span> Estoque de terceiros</button>
          <button className={`nav-item ${section === "insumos" ? "active" : ""}`} onClick={() => changeSection("insumos")}><span>▤</span> Embalagens e MP</button>
          <button className={`nav-item ${section === "consumo" ? "active" : ""}`} onClick={() => changeSection("consumo")}><span>◫</span> Consumo de insumos</button>
          <button className={`nav-item ${section === "escadinha" ? "active" : ""}`} onClick={() => changeSection("escadinha")}><span>▧</span> Escadinha geral</button>
          <button className={`nav-item ${section === "pedidosVenda" ? "active" : ""}`} onClick={() => changeSection("pedidosVenda")}><span>⇄</span> Estoque x Pedidos</button>
          {canViewValues && <button className={`nav-item ${section === "valores" ? "active" : ""}`} onClick={() => changeSection("valores")}><span>R$</span> Valor dos insumos</button>}
        </nav>
        <div className="sidebar-note">
          <span className="pulse-dot" />
          <div><strong>Dados atualizados</strong><small>{updated}</small></div>
        </div>
        <div className="profile"><span>CP</span><div><strong>Equipe de Compras</strong><small>Operação</small></div><i>···</i></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-logo-wrap"><img className="brand-logo" src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" /></span><strong>{isInputs ? "Embalagens e Matéria-Prima" : "Estoque de Terceiros"}</strong></div>
          <label className="global-search">
            <span>⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar produto, SKU ou fornecedor..." />
            <kbd>Ctrl K</kbd>
          </label>
          <div className="top-actions">
            <button className="primary-button" onClick={exportCsv}><span>↓</span> Exportar plano</button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div><p className="eyebrow">CONTROLE DE COBERTURA</p><h1>{isInputs ? "Embalagens e Matéria-Prima" : "Estoque de Terceiros"}</h1><p>Priorize o que pode faltar e evite capital parado em estoque.</p></div>
            <button className="source-button" onClick={() => setNotice(`Base atual: ${activeData.origem}.`)}><span>↻</span><div><small>Fonte atual</small><strong>{isInputs ? "Planilha de insumos" : "Planilha de terceiros"}</strong></div></button>
          </div>

          <section className="kpi-grid" aria-label="Indicadores principais">
            <button className="kpi-card critical-card" onClick={() => setStatus("Falta crítica")}>
              <div className="kpi-top"><span className="kpi-icon">!</span><span className="trend critical">Antecipar</span></div>
              <strong>{critical.length}</strong><p>Falta crítica antes da entrega</p><div className="mini-rule"><span style={{ width: `${Math.round((critical.length / products.length) * 100)}%` }} /></div>
              <small>Estoque projetado igual ou menor que zero</small>
            </button>
            <button className="kpi-card risk-card" onClick={() => setStatus("Estoque baixo")}>
              <div className="kpi-top"><span className="kpi-icon">↓</span><span className="trend bad">Ação hoje</span></div>
              <strong>{risk.length}</strong><p>Estoque abaixo do ponto de pedido</p><div className="mini-rule"><span style={{ width: `${Math.round((risk.length / products.length) * 100)}%` }} /></div>
              <small>{isInputs ? "Reposição calculada em kg ou unidades" : `${number.format(suggestedUnits)} cx sugeridas`}</small>
            </button>
            <button className="kpi-card excess-card" onClick={() => setStatus("Excesso")}>
              <div className="kpi-top"><span className="kpi-icon">↑</span><span className="trend warn">Revisar</span></div>
              <strong>{excess.length}</strong><p>Itens com estoque em excesso</p><div className="mini-rule"><span style={{ width: `${Math.round((excess.length / products.length) * 100)}%` }} /></div>
              <small>{isInputs ? "Excesso respeitando a unidade de cada item" : `${number.format(excessUnits)} cx acima da faixa`}</small>
            </button>
            <button className="kpi-card healthy-card" onClick={() => setStatus("Nível ideal")}>
              <div className="kpi-top"><span className="kpi-icon">✓</span><span className="trend good">Equilibrado</span></div>
              <strong>{healthy.length}</strong><p>Itens no nível ideal</p><div className="mini-rule"><span style={{ width: `${Math.round((healthy.length / products.length) * 100)}%` }} /></div>
              <small>{Math.round((healthy.length / products.length) * 100)}% do portfólio controlado</small>
            </button>
            <div className="kpi-card performance-card">
              <div className="kpi-top"><span className="kpi-icon">%</span><span className={`trend ${portfolioAttainment >= 100 ? "good" : "warn"}`}>{isInputs ? "Consumo / Escadinha" : "Faturado / Escadinha"}</span></div>
              <strong>{decimal.format(portfolioAttainment)}<sup>%</sup></strong><p>Atingimento total da projeção</p><div className="mini-rule performance-rule"><span style={{ width: `${Math.min(100, portfolioAttainment)}%` }} /></div>
              <small>{belowTarget} produtos abaixo da faixa de 85%</small>
            </div>
          </section>

          <section className="inventory-panel">
            <div className="panel-heading"><div><h2>Fila de decisão</h2><p>{mostrarDescontinuados ? `${descontinuadosFiltered.length} produtos sem giro encontrados` : `${filtered.length} produtos encontrados · ${scheduledDeliveries} entregas programadas${!isInputs ? ` · ${number.format(scheduledUnits)} cx` : ""}`}</p></div><div className="view-toggle"><button className="selected">Lista</button><button>Resumo</button></div></div>
            <div className="filters">
              {!mostrarDescontinuados && (
                <div className="status-tabs">
                  {(["Todos", "Falta crítica", "Estoque baixo", "Excesso", "Nível ideal"] as const).map((item) => (
                    <button key={item} className={status === item ? "selected" : ""} onClick={() => setStatus(item)}>{statusLabel(item)}{item !== "Todos" && <span>{products.filter((p) => p.status === item).length}</span>}</button>
                  ))}
                </div>
              )}
              <div className="selects">
                {isInputs && <MultiFilter label="Tipo" options={availableTypeOptions} selected={selectedTypes} onChange={(values) => { setSelectedTypes(values); setSelectedProducts([]); }} />}
                {isInputs && <MultiFilter label="Loja" options={stores.map((item) => ({ value: item, label: storeLabel(item) }))} selected={selectedStores} onChange={(values) => { setSelectedStores(values); setSelectedSuppliers([]); setSelectedProducts([]); }} />}
                <MultiFilter label="Fornecedor" options={suppliers.map((item) => ({ value: item, label: item }))} selected={selectedSuppliers} onChange={(values) => { setSelectedSuppliers(values); setSelectedProducts([]); }} />
                <MultiFilter label={isInputs ? "Produto / material" : "Produto"} options={productOptions} selected={selectedProducts} onChange={(values) => setSelectedProducts(values)} />
                {!mostrarDescontinuados && (
                  <>
                    <label>Segurança<select value={safety} onChange={(e) => setSafety(e.target.value)}><option>Todos</option>{safetyOptions.map((days) => <option key={days} value={days}>{days} dias</option>)}</select></label>
                    <label>Atingimento<select value={performance} onChange={(e) => setPerformance(e.target.value as typeof performance)}><option>Todos</option><option>Abaixo de 85%</option><option>De 85% a 99%</option><option>100% ou mais</option></select></label>
                    <label>Ordenar<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="urgencia">Maior urgência</option><option value="atingimento">Menor atingimento</option><option value="cobertura">Menor cobertura</option><option value="excesso">Maior excesso</option><option value="produto">Produto A–Z</option></select></label>
                  </>
                )}
                {descontinuados.length > 0 && (
                  <label className="toggle-inativos" title="Sem projeção, consumo recente ou entrega programada (ou marcado manualmente como fora de linha) — não conta nos indicadores de crítico/excesso.">
                    <input type="checkbox" checked={mostrarDescontinuados} onChange={(e) => setMostrarDescontinuados(e.target.checked)} />
                    Ver somente {descontinuados.length} sem giro
                  </label>
                )}
              </div>
            </div>
            <div className="table-wrap">
              <table className={isInputs ? "sticky-core-columns" : "terceiros-groups"} style={{ minWidth: `${(isInputs ? 1120 : 1720) + scheduleDates.length * 78}px` }}>
                <thead><tr>{isInputs ? <>
                  <th>Produto / fornecedor</th><th>Escadinha projetada</th><th>Consumo realizado</th><th>Atingimento</th><th>Estoque atual</th><th>Cobertura</th><th>Status</th>
                </> : <>
                  <th>Produto / fornecedor</th><th>Estoque atual</th><th>Carteira</th><th>Saldo</th><th>Cobertura</th><th>Escadinha atual</th><th>Real M</th><th>%Plano</th><th>Corte M</th><th>Status</th>
                </>}{scheduleDates.map((date, index) => { const overdue = isPastDelivery(date); return <th className={`delivery-date-heading ${index === 0 ? "delivery-block-start" : ""} ${overdue ? "overdue-delivery" : ""}`} title={overdue ? "Entrega em atraso" : undefined} key={date}><span>{overdue ? "Em atraso" : "Entrega"}</span><strong>{deliveryColumnDate.format(new Date(date))}</strong></th>; })}<th className="delivery-total-heading delivery-block-end"><span>Total</span><strong>Programado</strong></th><th /></tr></thead>
                <tbody>
                  {mostrarDescontinuados
                    ? descontinuadosFiltered.map((product) => renderProductRow(product, true))
                    : filtered.map((product) => renderProductRow(product, false))}
                </tbody>
              </table>
              {(mostrarDescontinuados ? descontinuadosFiltered.length === 0 : filtered.length === 0) && <div className="empty-state"><strong>Nenhum produto encontrado</strong><p>Tente remover um filtro ou buscar por outro termo.</p></div>}
            </div>
          </section>
          <footer>Fonte: {activeData.origem} <span>•</span> Classificação visual por ponto de pedido, lead time, segurança e tolerância de 20% do lote mínimo.</footer>
        </div>
      </section>

      {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="drawer" onClick={(e) => e.stopPropagation()}><button className="drawer-close" onClick={() => setSelected(null)}>×</button><p className="eyebrow">DETALHE DO PRODUTO</p><h2>{selected.produto}</h2><p className="drawer-sku">SKU {selected.sku} · {isInputs ? storeLabel(selected.loja) : selected.fornecedor}</p><span className={`status-pill ${statusClass[selected.status as Status]}`}><i />{statusLabel(selected.status)}</span><div className="drawer-performance"><div><small>ATINGIMENTO DA ESCADINHA</small><strong className={performanceClass(selected.atingimento, selected.escadinha)}>{selected.escadinha > 0 ? `${decimal.format(selected.atingimento)}%` : "Sem projeção"}</strong></div><div className="drawer-performance-bar"><span className={performanceClass(selected.atingimento, selected.escadinha)} style={{ width: `${Math.min(100, selected.atingimento)}%` }} /><i /></div><p>{decimal.format(selected.faturado)} {unitLabel(selected.unidade, selected.faturado)} {isInputs ? "consumido" : "faturado"} de {decimal.format(selected.escadinha)} {unitLabel(selected.unidade, selected.escadinha)} projetado · desvio de {selected.desvioProjecao >= 0 ? "+" : ""}{decimal.format(selected.desvioProjecao)} {unitLabel(selected.unidade, selected.desvioProjecao)}</p></div><div className="drawer-metrics"><div><small>Projetado (Escadinha)</small><strong>{decimal.format(selected.escadinha)} {unitLabel(selected.unidade, selected.escadinha)}</strong></div><div><small>{isInputs ? "Consumo realizado" : "Realizado do mês"}</small><strong>{isInputs || selectedMrp?.realMes == null ? `${decimal.format(selected.faturado)} ${unitLabel(selected.unidade, selected.faturado)}` : `${decimal.format(selectedMrp.realMes)} ${unitLabel(selected.unidade, selectedMrp.realMes)}`}</strong></div><div><small>Estoque atual</small><strong>{number.format(selected.estoque)} {unitLabel(selected.unidade, selected.estoque)}</strong></div><div><small>Cobertura</small><strong>{number.format(Math.round(selected.cobertura))} dias</strong></div><div><small>Estoque de segurança</small><strong>{selected.seguranca} dias</strong></div><div><small>Ponto de pedido</small><strong>{number.format(selected.pontoPedido)} {unitLabel(selected.unidade, selected.pontoPedido)}</strong></div><div><small>Estoque projetado na entrega</small><strong>{selected.estoqueProjetadoEntrega == null ? "Sem entrega futura" : `${number.format(selected.estoqueProjetadoEntrega)} ${unitLabel(selected.unidade, selected.estoqueProjetadoEntrega)}`}</strong></div><div><small>Limite de excesso</small><strong>{number.format(selected.limiteExcesso)} {unitLabel(selected.unidade, selected.limiteExcesso)}</strong></div><div><small>{selectedMonthlyValues.length > 0 ? "Consumo mensal (média 3 meses)" : "Consumo mensal"}</small><strong>{number.format(Math.round(selectedMonthlyAvg))} {unitLabel(selected.unidade, selectedMonthlyAvg)}</strong></div></div>{selectedMrp && <section className="drawer-mrp-history"><p className="eyebrow">HISTÓRICO DE COMPRA (MRP)</p><h3>Realizado e corte dos últimos 3 meses</h3><div className="drawer-mrp-months">{[1, 2, 3].map((n) => { const real = n === 1 ? selectedMrp.realMes1 : n === 2 ? selectedMrp.realMes2 : selectedMrp.realMes3; const corte = n === 1 ? selectedMrp.corteMes1 : n === 2 ? selectedMrp.corteMes2 : selectedMrp.corteMes3; return <div className="drawer-mrp-month" key={n}><small>{monthsAgoLabel(n)}</small><div><span>Real</span><strong>{real == null ? "—" : number.format(Math.round(real))}</strong></div><div><span>Corte</span><strong className={corte != null && corte > 0 ? "trend-up" : ""}>{corte == null ? "—" : number.format(Math.round(corte))}</strong></div></div>; })}</div></section>}<section className="delivery-schedule"><div className="schedule-heading"><div><small>AGENDA DE RECEBIMENTO</small><h3>Entregas programadas</h3></div><strong>{number.format(selected.totalProgramado)} {unitLabel(selected.unidade, selected.totalProgramado)}</strong></div>{selected.entregasProgramadas.length > 0 ? <div className="delivery-timeline">{selected.entregasProgramadas.map((item, index) => <div className="delivery-item" key={`${item.data}-${index}`}><span><i /></span><div><strong>{deliveryDateLong.format(new Date(item.data))}</strong><small>{index === 0 ? "Próxima entrega" : `Entrega ${index + 1}`}</small></div><b>{number.format(item.quantidade)} {unitLabel(selected.unidade, item.quantidade)}</b></div>)}</div> : <div className="empty-schedule">Nenhuma entrega programada para este produto.</div>}</section><div className="recommendation"><small>RECOMENDAÇÃO</small><strong>{selected.status === "Falta crítica" ? "Antecipar a primeira entrega do fornecedor" : selected.status === "Estoque baixo" ? "Cobrir o ponto de pedido e acompanhar o recebimento" : selected.status === "Excesso" ? "Suspender ou reagendar entregas futuras" : "Manter operação normal"}</strong><p>{selected.motivoStatus}</p></div><button className="primary-button full" onClick={() => { setNotice(`Ação registrada para o SKU ${selected.sku}.`); setSelected(null); }}>Marcar como analisado</button></aside></div>}
      {notice && <div className="toast"><span>✓</span>{notice}</div>}
    </main>
  );
}
