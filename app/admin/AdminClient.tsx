"use client";

import { useState } from "react";
import { SECOES, type Section } from "../lib/sections";
import { salvarUsuarioAction, removerUsuarioAction } from "./actions";
import type { Usuario } from "../lib/access";

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

export default function AdminClient({ usuarios, meuEmail }: { usuarios: Usuario[]; meuEmail: string }) {
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
      <a href="/" className="admin-voltar">← Voltar pro painel</a>
    </div>
  );
}
