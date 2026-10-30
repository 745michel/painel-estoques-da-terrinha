// Fonte unica das 10 secoes/menus do painel - usado tanto pelo menu lateral
// (app/DashboardClient.tsx) quanto pelo controle de acesso por menu (app/lib/access.ts,
// app/admin). Mudar aqui e a unica mudanca necessaria pra adicionar/remover um menu do
// controle de acesso granular (28/10/2026).
export const SECOES = [
  { key: "terceiros", label: "Estoque de terceiros", financeiro: false },
  { key: "insumos", label: "Embalagens e MP", financeiro: false },
  { key: "consumo", label: "Consumo de insumos", financeiro: false },
  { key: "escadinha", label: "Escadinha geral", financeiro: false },
  { key: "escadinhaInsumos", label: "Escadinha de insumos", financeiro: false },
  { key: "pedidosVenda", label: "Estoque x Pedidos", financeiro: false },
  { key: "cortes", label: "Cortes", financeiro: false },
  { key: "validade", label: "Validade dos produtos", financeiro: false },
  { key: "valores", label: "Valor dos insumos", financeiro: true },
  { key: "valorProdutoAcabado", label: "Valor produto acabado", financeiro: true },
  { key: "fornecedores", label: "Fornecedores", financeiro: true },
] as const;

export type Section = (typeof SECOES)[number]["key"];

export const SECTION_KEYS: Section[] = SECOES.map((s) => s.key);

export function isSection(valor: string): valor is Section {
  return (SECTION_KEYS as string[]).includes(valor);
}
