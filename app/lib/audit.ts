// Auditoria (28/10/2026, pedido do usuario) - 3 camadas: log de login (quem logou, de onde,
// se o painel autorizou), log de mudanca de permissao (quem alterou o acesso de quem) e,
// implicitamente, o IP so e capturado no momento do login (nao em cada clique dentro do
// painel - log por acao seria ruido pra esse porte de equipe). Ver app/admin/AdminClient.tsx
// pra onde isso aparece.
import { getSql } from "./pg";
import type { Usuario } from "./access";

export type LoginAuditLinha = {
  email: string;
  autorizado: boolean;
  ip: string | null;
  userAgent: string | null;
  criadoEm: string;
};

export type PermissaoAuditLinha = {
  alteradoPor: string;
  alvoEmail: string;
  acao: "salvar" | "remover";
  antes: Usuario | null;
  depois: Usuario | null;
  criadoEm: string;
};

export async function registrarLogin(opts: {
  email: string;
  autorizado: boolean;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const sql = getSql();
  await sql`
    insert into login_audit (email, autorizado, ip, user_agent)
    values (${opts.email}, ${opts.autorizado}, ${opts.ip}, ${opts.userAgent})
  `;
}

export async function listarLoginAudit(limite = 50): Promise<LoginAuditLinha[]> {
  const sql = getSql();
  const linhas = await sql`
    select email, autorizado, ip, user_agent, criado_em
    from login_audit
    order by criado_em desc
    limit ${limite}
  `;
  return linhas.map((l: any) => ({
    email: l.email,
    autorizado: l.autorizado,
    ip: l.ip,
    userAgent: l.user_agent,
    criadoEm: l.criado_em instanceof Date ? l.criado_em.toISOString() : l.criado_em,
  }));
}

export async function registrarPermissaoAudit(opts: {
  alteradoPor: string;
  alvoEmail: string;
  acao: "salvar" | "remover";
  antes: Usuario | null;
  depois: Usuario | null;
}): Promise<void> {
  const sql = getSql();
  await sql`
    insert into permissao_audit (alterado_por, alvo_email, acao, antes, depois)
    values (${opts.alteradoPor}, ${opts.alvoEmail}, ${opts.acao}, ${sql.json(opts.antes as any)}, ${sql.json(opts.depois as any)})
  `;
}

export async function listarPermissaoAudit(limite = 50): Promise<PermissaoAuditLinha[]> {
  const sql = getSql();
  const linhas = await sql`
    select alterado_por, alvo_email, acao, antes, depois, criado_em
    from permissao_audit
    order by criado_em desc
    limit ${limite}
  `;
  return linhas.map((l: any) => ({
    alteradoPor: l.alterado_por,
    alvoEmail: l.alvo_email,
    acao: l.acao,
    antes: l.antes,
    depois: l.depois,
    criadoEm: l.criado_em instanceof Date ? l.criado_em.toISOString() : l.criado_em,
  }));
}
