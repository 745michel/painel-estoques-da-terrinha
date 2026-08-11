// Mapa de lojas compartilhado entre o painel (chave numerica) e as extracoes do Power
// Automate/Power BI (nome completo da loja). Ver REGRAS_PAINEL_ESTOQUES.md.

export const STORE_NAMES: Record<string, string> = {
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

const DIACRITICS_PATTERN = new RegExp("[̀-ͯ]", "g");

export function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(DIACRITICS_PATTERN, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const NAME_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(STORE_NAMES).map(([key, name]) => [normalize(name), key]),
);

/** Converte o nome completo de loja (como vem do Power BI/Power Automate) na chave numerica usada no painel. */
export function storeKeyFromName(name: string | null | undefined): string | null {
  return NAME_TO_KEY[normalize(name)] ?? null;
}
