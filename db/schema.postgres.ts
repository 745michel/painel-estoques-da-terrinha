// Schema Postgres (Railway) - Fase 2 da migracao (ver plano em
// C:\Users\Daterrinha63\.claude\plans\synchronous-wobbling-fern.md). NAO mexe em db/schema.ts
// (D1/sqlite, scaffolding do vinext-starter, continua vazio/intocado).
//
// Uma tabela por dataset, nao um redesenho normalizado: colunas explicitas so pras chaves que
// REGRAS_PAINEL_ESTOQUES.md/CLAUDE.md ja estabelecem como "linha de verdade" (loja + sku +
// nome completo do produto, nunca sku sozinho - risco de linha fantasma documentado), o resto
// de cada linha vai pra uma coluna "dados" jsonb. Datasets com estrutura muito aninhada/nao
// tabular (escadinha_insumos, as 3 financeiras exceto cortes_valores) viram tabela "snapshot"
// (1 linha, o JSON inteiro em "dados") em vez de forcar decomposicao - o app hoje consome esses
// 4 como um blob coeso de qualquer forma (toda filtragem/agregacao e client-side).
//
// Sincronizado por work/sheet-inspect/sync_postgres.py, que le os MESMOS JSON ja gerados pelo
// pipeline local (nenhuma logica de extracao nova) e faz truncate+insert por tabela, mesma
// semantica de "arquivo inteiro substituido" que o pipeline ja usa hoje (escrita atomica).
import { pgTable, text, integer, jsonb, timestamp, boolean, serial, date } from "drizzle-orm/pg-core";

// ---------- operacionais (array de produtos, linha a linha) ----------

export const estoqueTerceiros = pgTable("estoque_terceiros", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull(),
  loja: text("loja").notNull(),
  produto: text("produto").notNull(),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const insumosEmbalagens = pgTable("insumos_embalagens", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull(),
  loja: text("loja").notNull(),
  produto: text("produto").notNull(),
  categoria: text("categoria"),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const consumoInsumos = pgTable("consumo_insumos", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull(),
  loja: text("loja").notNull(),
  produto: text("produto").notNull(),
  categoria: text("categoria"),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const escadinhaGeral = pgTable("escadinha_geral", {
  id: serial("id").primaryKey(),
  cod: integer("cod"),
  produto: text("produto").notNull(),
  categoria: text("categoria"),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const escadinhaDesvios = pgTable("escadinha_desvios", {
  id: serial("id").primaryKey(),
  cod: integer("cod"),
  produto: text("produto").notNull(),
  mes: text("mes").notNull(),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const pedidosVenda = pgTable("pedidos_venda", {
  id: serial("id").primaryKey(),
  cod: integer("cod").notNull(),
  loja: text("loja").notNull(),
  produto: text("produto").notNull(),
  categoria: text("categoria"),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const cortes = pgTable("cortes", {
  id: serial("id").primaryKey(),
  data: date("data").notNull(),
  lojaKey: integer("loja_key"),
  produtoKey: integer("produto_key").notNull(),
  categoria: text("categoria"),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const cortesAtendidos = pgTable("cortes_atendidos", {
  id: serial("id").primaryKey(),
  mes: text("mes").notNull(),
  lojaKey: integer("loja_key"),
  produtoKey: integer("produto_key").notNull(),
  categoria: text("categoria"),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

// ---------- financeiras (senha-gated no app; so o server consulta) ----------

export const cortesValores = pgTable("cortes_valores", {
  id: serial("id").primaryKey(),
  data: date("data").notNull(),
  lojaKey: integer("loja_key"),
  produtoKey: integer("produto_key").notNull(),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const cortesValoresAtendidos = pgTable("cortes_valores_atendidos", {
  id: serial("id").primaryKey(),
  mes: text("mes").notNull(),
  lojaKey: integer("loja_key"),
  produtoKey: integer("produto_key").notNull(),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

// ---------- snapshots (estrutura aninhada demais pra linha-a-linha por agora) ----------

export const escadinhaInsumosSnapshot = pgTable("escadinha_insumos_snapshot", {
  id: integer("id").primaryKey().default(1),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const valoresInsumosSnapshot = pgTable("valores_insumos_snapshot", {
  id: integer("id").primaryKey().default(1),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const valoresProdutoAcabadoSnapshot = pgTable("valores_produto_acabado_snapshot", {
  id: integer("id").primaryKey().default(1),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

export const fornecedoresSnapshot = pgTable("fornecedores_snapshot", {
  id: integer("id").primaryKey().default(1),
  dados: jsonb("dados").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
});

// ---------- observabilidade ----------

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  dataset: text("dataset").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rowCount: integer("row_count"),
  ok: boolean("ok").notNull().default(false),
  erro: text("erro"),
});
