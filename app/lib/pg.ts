// Cliente Postgres (Railway, Fase 3 da migracao - ver CLAUDE.md). DATABASE_URL (host interno,
// so alcancavel de dentro da rede privada do Railway) e injetado automaticamente quando este
// app roda como servico no Railway - nao precisa de nenhuma reescrita aqui. DATABASE_PUBLIC_URL
// e usado so em dev local, com um tunel SSH aberto (`railway connect Postgres --tunnel-only -P
// 55432`) - ver automation/sincronizar_postgres.ps1 pro mesmo padrao usado na sincronizacao.
import postgres from "postgres";

let sqlClient: ReturnType<typeof postgres> | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL);
}

function getSql() {
  if (!sqlClient) {
    let url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL/DATABASE_PUBLIC_URL nao configurado.");
    // PG_USE_SSH_TUNNEL=1: so pra dev local/scripts de verificacao, com
    // `railway connect Postgres --tunnel-only -P 55432` aberto (ver automation/
    // sincronizar_postgres.ps1). Nunca ativado em producao - no Railway, DATABASE_URL (host
    // interno) ja funciona direto, sem tunel.
    if (process.env.PG_USE_SSH_TUNNEL === "1") {
      const u = new URL(url);
      u.hostname = "localhost";
      u.port = "55432";
      url = u.toString();
    }
    sqlClient = postgres(url, { prepare: false });
  }
  return sqlClient;
}

/** Le todas as linhas de uma tabela "1 tabela por dataset" (so a coluna dados, ja e o objeto original). */
export async function queryRows<T = any>(tabela: string): Promise<T[]> {
  const sql = getSql();
  const linhas = await sql.unsafe(`select dados from ${tabela} order by id`);
  return (linhas as unknown as Array<{ dados: T }>).map((l) => l.dados);
}

/** Le os campos irmaos (origem/atualizadoEm/dataPublicacao/mesesCorte/...) de um dataset. */
export async function queryMeta<T = Record<string, unknown>>(dataset: string): Promise<T | null> {
  const sql = getSql();
  const linhas = await sql.unsafe(`select meta from dataset_meta where dataset = $1`, [dataset]);
  return (linhas as unknown as Array<{ meta: T }>)[0]?.meta ?? null;
}

/** Le uma tabela snapshot (1 linha, id=1, dados = objeto inteiro original). */
export async function querySnapshot<T = any>(tabela: string): Promise<T> {
  const sql = getSql();
  const linhas = await sql.unsafe(`select dados from ${tabela} where id = 1`);
  const dados = (linhas as unknown as Array<{ dados: T }>)[0]?.dados;
  if (dados === undefined) throw new Error(`Snapshot vazio: ${tabela}`);
  return dados;
}
