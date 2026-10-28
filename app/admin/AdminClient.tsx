"use client";

import { useState } from "react";
import { SECOES, type Section } from "../lib/sections";
import { salvarUsuarioAction, removerUsuarioAction } from "./actions";
import type { Usuario } from "../lib/access";
import type { LoginAuditLinha, PermissaoAuditLinha } from "../lib/audit";

const formatoData = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function resumoMudanca(linha: PermissaoAuditLinha): string {
  if (linha.acao === "remover") return "Removido";
  if (!linha.antes) return "Criado";
  const antes = linha.antes;
  const depois = linha.depois;
  if (!depois) return "—";
  const mudancas: string[] = [];
  if (antes.ativo !== depois.ativo) mudancas.push(depois.ativo ? "ativado" : "desativado");
  if (antes.admin !== depois.admin) mudancas.push(depois.admin ? "virou admin" : "deixou de ser admin");
  const antesSet = new Set(antes.permissoes);
  const depoisSet = new Set(depois.permissoes);
  const adicionadas = depois.permissoes.filter((p) => !antesSet.has(p));
  const removidas = antes.permissoes.filter((p) => !depoisSet.has(p));
  if (adicionadas.length) mudancas.push(`+${adicionadas.join(", ")}`);
  if (removidas.length) mudancas.push(`-${removidas.join(", ")}`);
  return mudancas.length ? mudancas.join(" · ") : "sem alteração";
}

function LinhaUsuario({ usuario, meuEmail }: { usuario: Usuario; meuEmail: string }) {
  const [permissoes, setPermissoes] = useState<Set<Section>>(new Set(usuario.permissoes));
  const souEu = usuario.email === meuEmail;

  function alternar(secao: Section) {
    setPermissoes((atual) => {
      const novo = new Set(atual);
      if (novo.has(secao)) novo.delete(secao);
      else novo.add(secao);
      return novo;
    });
  }

  return (
    <form action={salvarUsuarioAction} className="admin-linha">
      <input type="hidden" name="email" value={usuario.email} />
      <div className="admin-linha-topo">
        <strong>{usuario.email}</strong>
        {souEu && <span className="admin-voce">(você)</span>}
        <input name="nome" defaultValue={usuario.nome ?? ""} placeholder="Nome" className="admin-input-nome" />
        <label className="admin-check">
          <input type="checkbox" name="ativo" defaultChecked={usuario.ativo} /> Ativo
        </label>
        <label className="admin-check">
          <input type="checkbox" name="admin" defaultChecked={usuario.admin} disabled={souEu} /> Administrador
        </label>
      </div>
      <div className="admin-permissoes">
        {SECOES.map((s) => (
          <label key={s.key} className={`admin-check${s.financeiro ? " admin-check-financeiro" : ""}`}>
            <input
              type="checkbox"
              name="permissoes"
              value={s.key}
              checked={permissoes.has(s.key)}
              onChange={() => alternar(s.key)}
            />
            {s.label}
          </label>
        ))}
      </div>
      <div className="admin-linha-acoes">
        <button type="submit" className="admin-botao-salvar">Salvar</button>
        {!souEu && (
          <button
            type="submit"
            formAction={removerUsuarioAction.bind(null, usuario.email)}
            className="admin-botao-remover"
          >
            Remover
          </button>
        )}
      </div>
    </form>
  );
}

function NovoUsuarioForm() {
  const [permissoes, setPermissoes] = useState<Set<Section>>(new Set());

  function alternar(secao: Section) {
    setPermissoes((atual) => {
      const novo = new Set(atual);
      if (novo.has(secao)) novo.delete(secao);
      else novo.add(secao);
      return novo;
    });
  }

  return (
    <form action={salvarUsuarioAction} className="admin-linha admin-linha-novo">
      <div className="admin-linha-topo">
        <input name="email" placeholder="email@daterrinhaalimentos.com.br" required className="admin-input-email" />
        <input name="nome" placeholder="Nome" className="admin-input-nome" />
        <label className="admin-check">
          <input type="checkbox" name="ativo" defaultChecked /> Ativo
        </label>
        <label className="admin-check">
          <input type="checkbox" name="admin" /> Administrador
        </label>
      </div>
      <div className="admin-permissoes">
        {SECOES.map((s) => (
          <label key={s.key} className={`admin-check${s.financeiro ? " admin-check-financeiro" : ""}`}>
            <input type="checkbox" name="permissoes" value={s.key} checked={permissoes.has(s.key)} onChange={() => alternar(s.key)} />
            {s.label}
          </label>
        ))}
      </div>
      <div className="admin-linha-acoes">
        <button type="submit" className="admin-botao-salvar">Adicionar usuário</button>
      </div>
    </form>
  );
}

function AuditoriaLogin({ linhas }: { linhas: LoginAuditLinha[] }) {
  if (linhas.length === 0) return <p className="admin-vazio">Nenhum login registrado ainda.</p>;
  return (
    <div className="admin-tabela-wrap">
      <table className="admin-tabela">
        <thead>
          <tr><th>Quando</th><th>E-mail</th><th>Resultado</th><th>IP</th><th>Navegador</th></tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i}>
              <td>{formatoData.format(new Date(l.criadoEm))}</td>
              <td>{l.email}</td>
              <td>
                <span className={`admin-status-pill${l.autorizado ? " ok" : " negado"}`}>
                  {l.autorizado ? "Autorizado" : "Sem acesso"}
                </span>
              </td>
              <td>{l.ip ?? "—"}</td>
              <td className="admin-user-agent" title={l.userAgent ?? ""}>{l.userAgent ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditoriaPermissoes({ linhas }: { linhas: PermissaoAuditLinha[] }) {
  if (linhas.length === 0) return <p className="admin-vazio">Nenhuma alteração registrada ainda.</p>;
  return (
    <div className="admin-tabela-wrap">
      <table className="admin-tabela">
        <thead>
          <tr><th>Quando</th><th>Alterado por</th><th>Pessoa afetada</th><th>O que mudou</th></tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i}>
              <td>{formatoData.format(new Date(l.criadoEm))}</td>
              <td>{l.alteradoPor}</td>
              <td>{l.alvoEmail}</td>
              <td>{resumoMudanca(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminClient({
  usuarios,
  meuEmail,
  loginAudit,
  permissaoAudit,
}: {
  usuarios: Usuario[];
  meuEmail: string;
  loginAudit: LoginAuditLinha[];
  permissaoAudit: PermissaoAuditLinha[];
}) {
  return (
    <div className="admin-container">
      <h1>Administração de acessos</h1>
      <p className="admin-intro">
        Marque quais menus cada pessoa pode ver. Quem não está nesta lista, ou está marcado como
        "Inativo", vê a tela de acesso não liberado ao logar.
      </p>
      <section className="admin-bloco">
        <h2>Adicionar pessoa</h2>
        <NovoUsuarioForm />
      </section>
      <section className="admin-bloco">
        <h2>Pessoas com acesso ({usuarios.length})</h2>
        {usuarios.map((u) => (
          <LinhaUsuario key={u.email} usuario={u} meuEmail={meuEmail} />
        ))}
      </section>
      <section className="admin-bloco">
        <h2>Auditoria · logins recentes</h2>
        <AuditoriaLogin linhas={loginAudit} />
      </section>
      <section className="admin-bloco">
        <h2>Auditoria · mudanças de permissão</h2>
        <AuditoriaPermissoes linhas={permissaoAudit} />
      </section>
      <a href="/" className="admin-voltar">← Voltar pro painel</a>
    </div>
  );
}
