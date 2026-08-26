import esbuild from "esbuild";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = esbuild;
const outputDir = path.join(root, "gh-pages-dist");
const logo = await readFile(path.join(root, "public", "logo-da-terrinha.webp"));
const logoDataUrl = `data:image/webp;base64,${logo.toString("base64")}`;
const css = (await readFile(path.join(root, "app", "globals.css"), "utf8"))
  .replace('@import "tailwindcss";', "")
  .replaceAll("var(--font-geist-sans)", "Arial")
  .replaceAll("var(--font-geist-mono)", "Consolas");

await mkdir(outputDir, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, "scripts", "github-pages-entry.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  loader: { ".json": "json" },
  outfile: "app.js",
});

const jsOutput = result.outputFiles.find((file) => file.path.endsWith(".js"));
if (!jsOutput) throw new Error("Falha ao empacotar github-pages-entry.tsx.");

const javascript = jsOutput.text.replaceAll("/logo-da-terrinha.webp", logoDataUrl);
const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Controle de Estoques | Da Terrinha</title>
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script>${javascript.replaceAll("</script", "<\\/script")}</script>
</body>
</html>`;

await writeFile(path.join(outputDir, "index.html"), html, "utf8");

// Financeiro fica FORA do bundle JS - arquivo separado, so buscado depois da senha certa
// no navegador (ver work/github-pages-entry.tsx). Se o CI nao gerou (SharePoint fora do
// ar), usa o placeholder do repo em vez de falhar o deploy inteiro.
const financeiroCi = path.join(root, "work", "valor-financeiro-ci.json");
const financeiroPlaceholder = path.join(root, "data", "dados-valores-insumos.json");
const financeiroDestino = path.join(outputDir, "valor-financeiro.json");
try {
  await copyFile(financeiroCi, financeiroDestino);
} catch {
  console.warn("valor-financeiro-ci.json nao encontrado, usando placeholder");
  await copyFile(financeiroPlaceholder, financeiroDestino);
}

// Mesmo esquema pra produto acabado (ver app/lib/valor-produto-acabado.ts, pedido do usuario
// em 21/08/2026).
const financeiroProdutoAcabadoCi = path.join(root, "work", "valor-financeiro-produto-acabado-ci.json");
const financeiroProdutoAcabadoPlaceholder = path.join(root, "data", "dados-valores-produto-acabado.json");
const financeiroProdutoAcabadoDestino = path.join(outputDir, "valor-financeiro-produto-acabado.json");
try {
  await copyFile(financeiroProdutoAcabadoCi, financeiroProdutoAcabadoDestino);
} catch {
  console.warn("valor-financeiro-produto-acabado-ci.json nao encontrado, usando placeholder");
  await copyFile(financeiroProdutoAcabadoPlaceholder, financeiroProdutoAcabadoDestino);
}

// Mesmo esquema pra fornecedores (ver work/sheet-inspect/build_fornecedores.py, pedido do
// usuario em 26/08/2026) - CI so buscou o agregado pequeno, nunca o compras_produto.json bruto.
const financeiroFornecedoresCi = path.join(root, "work", "valor-financeiro-fornecedores-ci.json");
const financeiroFornecedoresPlaceholder = path.join(root, "data", "dados-fornecedores.json");
const financeiroFornecedoresDestino = path.join(outputDir, "valor-financeiro-fornecedores.json");
try {
  await copyFile(financeiroFornecedoresCi, financeiroFornecedoresDestino);
} catch {
  console.warn("valor-financeiro-fornecedores-ci.json nao encontrado, usando placeholder");
  await copyFile(financeiroFornecedoresPlaceholder, financeiroFornecedoresDestino);
}

console.log(JSON.stringify({ pasta: outputDir, tamanho_html_bytes: Buffer.byteLength(html) }));
