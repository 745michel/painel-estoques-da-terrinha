// Config do Drizzle Kit so pro schema Postgres novo (db/schema.postgres.ts) - NAO mexe em
// drizzle.config.ts (sqlite/D1, scaffolding intocado). Roda via
// `railway run --service Postgres -- npx drizzle-kit push --config drizzle.config.postgres.ts`
// pra pegar DATABASE_URL do ambiente do servico sem nunca precisar colar a credencial aqui.
import { defineConfig } from "drizzle-kit";

// Se so tiver DATABASE_URL (host interno do Railway, so alcancavel de dentro da rede privada),
// reescreve pro tunel SSH local aberto com `railway connect Postgres --tunnel-only -P 55432`
// (ver CLAUDE.md da migracao Railway) - nunca imprime/grava a credencial, so troca host/porta
// em memoria no momento de montar a URL.
function resolveUrl(): string {
  if (process.env.DATABASE_PUBLIC_URL) return process.env.DATABASE_PUBLIC_URL;
  const internal = process.env.DATABASE_URL;
  if (!internal) throw new Error("DATABASE_URL/DATABASE_PUBLIC_URL nao definido.");
  const u = new URL(internal);
  u.hostname = "localhost";
  u.port = "55432";
  return u.toString();
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.postgres.ts",
  dbCredentials: {
    url: resolveUrl(),
  },
});
