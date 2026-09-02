import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "../app/DashboardClient";
import estoqueData from "../public/dados-estoque.json";
import insumosData from "../public/dados-insumos.json";
import consumoData from "../public/dados-consumo-insumos.json";
import mrpTerceirosData from "../public/dados-mrp-terceiros.json";
import escadinhaData from "../public/dados-escadinha.json";
import escadinhaInsumosData from "../public/dados-escadinha-insumos.json";
import pedidosVendaData from "../public/dados-pedidos-venda.json";
import type valoresDataType from "../data/dados-valores-insumos.json";
import type valoresProdutoAcabadoDataType from "../data/dados-valores-produto-acabado.json";
import type fornecedoresDataType from "../data/dados-fornecedores.json";

type ValoresData = typeof valoresDataType;
type ValoresProdutoAcabadoData = typeof valoresProdutoAcabadoDataType;
type FornecedoresData = typeof fornecedoresDataType;

/**
 * Barreira so no navegador (sem servidor no GitHub Pages para proteger de verdade - ver
 * CLAUDE.md, 11/08/2026). Compara o hash SHA-256 da senha digitada contra o hash embutido
 * abaixo - a senha em texto puro nao fica no bundle, mas quem souber ler o JS ainda pode
 * quebrar o hash offline ou so pegar o arquivo direto pela aba de rede do navegador. O JSON
 * financeiro so e buscado (fetch relativo, arquivo separado) depois do hash bater, para nao
 * vir baixado pra quem so abrir a pagina e nunca digitar nada. Decisao explicita do usuario,
 * aceitando esse limite de seguranca.
 */
const SENHA_HASH = "2cdb977fdca2dd2c707674e5deb0a4a392d8bc1ec7fd2b4dff121053b41a575e";

async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function App() {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [valoresData, setValoresData] = useState<ValoresData | null>(null);
  const [valoresProdutoAcabadoData, setValoresProdutoAcabadoData] = useState<ValoresProdutoAcabadoData | null>(null);
  const [fornecedoresData, setFornecedoresData] = useState<FornecedoresData | null>(null);
  const [desbloqueado, setDesbloqueado] = useState(false);

  async function tentarDesbloquear(event: React.FormEvent) {
    event.preventDefault();
    setCarregando(true);
    setErro(false);
    try {
      const hash = await sha256Hex(senha);
      if (hash !== SENHA_HASH) {
        setErro(true);
        return;
      }
      // cache: "no-store" - o GitHub Pages manda Cache-Control: max-age=600 nesses arquivos, e a
      // automacao atualiza os dados varias vezes por dia. Sem isso, o navegador podia mostrar
      // valor financeiro com ate 10 minutos de atraso mesmo depois de reabrir a pagina.
      const [response, responseProdutoAcabado, responseFornecedores] = await Promise.all([
        fetch("./valor-financeiro.json", { cache: "no-store" }),
        fetch("./valor-financeiro-produto-acabado.json", { cache: "no-store" }),
        fetch("./valor-financeiro-fornecedores.json", { cache: "no-store" }),
      ]);
      if (!response.ok || !responseProdutoAcabado.ok || !responseFornecedores.ok) throw new Error("arquivo indisponivel");
      const data = (await response.json()) as ValoresData;
      const dataProdutoAcabado = (await responseProdutoAcabado.json()) as ValoresProdutoAcabadoData;
      const dataFornecedores = (await responseFornecedores.json()) as FornecedoresData;
      setValoresData(data);
      setValoresProdutoAcabadoData(dataProdutoAcabado);
      setFornecedoresData(dataFornecedores);
      setDesbloqueado(true);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      <DashboardClient
        canViewValues={desbloqueado}
        valoresData={desbloqueado ? valoresData : null}
        valoresProdutoAcabadoData={desbloqueado ? valoresProdutoAcabadoData : null}
        fornecedoresData={desbloqueado ? fornecedoresData : null}
        estoqueData={estoqueData}
        insumosData={insumosData}
        consumoData={consumoData}
        mrpTerceirosData={mrpTerceirosData}
        escadinhaData={escadinhaData}
        escadinhaInsumosData={escadinhaInsumosData}
        pedidosVendaData={pedidosVendaData}
      />
      {!desbloqueado && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 16,
            boxShadow: "0 2px 16px rgba(0,0,0,0.12)",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            width: 260,
            zIndex: 9999,
          }}
        >
          <form onSubmit={tentarDesbloquear}>
            <label style={{ display: "block", marginBottom: 6, color: "#555" }}>
              Senha para ver valores financeiros:
            </label>
            <input
              type="password"
              value={senha}
              onChange={(event) => setSenha(event.target.value)}
              style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ccc", marginBottom: 8, boxSizing: "border-box" }}
            />
            <button
              type="submit"
              disabled={carregando}
              style={{ width: "100%", padding: 8, borderRadius: 6, border: "none", background: "#2f6f4f", color: "#fff", cursor: "pointer" }}
            >
              {carregando ? "Verificando..." : "Desbloquear"}
            </button>
            {erro && <p style={{ color: "#c0392b", marginTop: 6, marginBottom: 0 }}>Senha incorreta.</p>}
          </form>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
