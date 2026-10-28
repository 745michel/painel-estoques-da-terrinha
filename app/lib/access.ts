// Controle de acesso do painel (28/10/2026) - substitui a lista "AcessoPainelEstoques" do
// SharePoint. Tabela "usuarios" no Postgres (db/schema.postgres.ts), gerenciada pelo menu de
// administracao em app/admin (so quem tem admin=true acessa). Login (Entra ID) continua so
// provando identidade - quem pode ver o que e decidido aqui, por e-mail.
import { getSql, isDbConfigured } from "./pg";
import { SECTION_KEYS, isSection, type Section } from "./sections";

export type Usuario = {
  email: string;
  nome: string | null;
  ativo: boolean;
  admin: boolean;
  permissoes: Section[];
  atualizadoEm: string;
};

function normalizarEmail(email: string): string {
  return email.trim().toLocaleLowerCase("pt-BR");
}

function linhaParaUsuario(linha: any): Usuario {
  return {
    email: linha.email,
    nome: linha.nome,
    ativo: linha.ativo,
    admin: linha.admin,
    permissoes: (linha.permissoes ?? []).filter(isSection),
    atualizadoEm: linha.atualizado_em instanceof Date ? linha.atualizado_em.toISOString() : linha.atualizado_em,
  };
}

/** Resultado da checagem de acesso pra uma sessao logada (app/page.tsx). */
export type ResolveAccessResult = {
  autorizado: boolean;
  permissoes: Section[];
  isAdmin: boolean;
  baseIndisponivel: boolean;
};

/**
 * Mesma filosofia de antes (ver CLAUDE.md): falha de infra nao bloqueia todo mundo. Se o
 * Postgres nao estiver configurado/acessivel, deixa entrar na parte operacional (secoes nao
 * financeiras) e nega as financeiras - nunca derruba o painel inteiro por uma falha de banco.
 */
export async function resolveAccess(email: string): Promise<ResolveAccessResult> {
  const normalizado = normalizarEmail(email);
  if (!isDbConfigured()) {
    return {
      autorizado: true,
      permissoes: SECTION_KEYS.filter((s) => !SECOES_FINANCEIRAS.has(s)),
      isAdmin: false,
      baseIndisponivel: true,
    };
  }
  try {
    const usuario = await getUsuario(normalizado);
    if (!usuario || !usuario.ativo) {
      return { autorizado: false, permissoes: [], isAdmin: false, baseIndisponivel: false };
    }
    return { autorizado: true, permissoes: usuario.permissoes, isAdmin: usuario.admin, baseIndisponivel: false };
  } catch (error) {
    console.error("Falha ao consultar usuarios no Postgres:", error);
    return {
      autorizado: true,
      permissoes: SECTION_KEYS.filter((s) => !SECOES_FINANCEIRAS.has(s)),
      isAdmin: false,
      baseIndisponivel: true,
    };
  }
}

const SECOES_FINANCEIRAS = new Set<Section>(["valores", "valorProdutoAcabado", "fornecedores"]);

export async function getUsuario(email: string): Promise<Usuario | null> {
  const sql = getSql();
  const linhas = await sql`select * from usuarios where email = ${normalizarEmail(email)}`;
  return linhas[0] ? linhaParaUsuario(linhas[0]) : null;
}

export async function listarUsuarios(): Promise<Usuario[]> {
  const sql = getSql();
  const linhas = await sql`select * from usuarios order by email`;
  return linhas.map(linhaParaUsuario);
}

export async function salvarUsuario(opts: {
  email: string;
  nome: string | null;
  ativo: boolean;
  admin: boolean;
  permissoes: Section[];
}): Promise<void> {
  const sql = getSql();
  const email = normalizarEmail(opts.email);
  const permissoes = opts.permissoes.filter(isSection);
  await sql`
    insert into usuarios (email, nome, ativo, admin, permissoes, atualizado_em)
    values (${email}, ${opts.nome}, ${opts.ativo}, ${opts.admin}, ${permissoes}, now())
    on conflict (email) do update set
      nome = excluded.nome,
      ativo = excluded.ativo,
      admin = excluded.admin,
      permissoes = excluded.permissoes,
      atualizado_em = now()
  `;
}

export async function removerUsuario(email: string): Promise<void> {
  const sql = getSql();
  await sql`delete from usuarios where email = ${normalizarEmail(email)}`;
}
