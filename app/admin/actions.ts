"use server";

import { revalidatePath } from "next/cache";
import { auth } from "../../auth";
import { getUsuario, salvarUsuario, removerUsuario } from "../lib/access";
import { isSection, type Section } from "../lib/sections";
import { registrarPermissaoAudit } from "../lib/audit";

/** Toda acao confere admin=true de novo aqui dentro - a tela so esconder os controles nao basta. */
async function exigirAdmin(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLocaleLowerCase("pt-BR");
  if (!email) throw new Error("Nao autenticado.");
  const usuario = await getUsuario(email);
  if (!usuario?.admin) throw new Error("Essa conta nao tem permissao de administrador.");
  return email;
}

export async function salvarUsuarioAction(formData: FormData): Promise<void> {
  const quemPediu = await exigirAdmin();
  const email = String(formData.get("email") ?? "").trim();
  if (!email) throw new Error("E-mail obrigatorio.");
  const nome = String(formData.get("nome") ?? "").trim() || null;
  const ativo = formData.get("ativo") === "on";
  const admin = formData.get("admin") === "on";
  const permissoes = formData.getAll("permissoes").map(String).filter(isSection) as Section[];
  const antes = await getUsuario(email);
  await salvarUsuario({ email, nome, ativo, admin, permissoes });
  const depois = await getUsuario(email);
  await registrarPermissaoAudit({ alteradoPor: quemPediu, alvoEmail: email, acao: "salvar", antes, depois });
  revalidatePath("/admin");
}

export async function removerUsuarioAction(email: string): Promise<void> {
  const quemPediu = await exigirAdmin();
  if (quemPediu === email.trim().toLocaleLowerCase("pt-BR")) {
    throw new Error("Voce nao pode remover a si mesmo.");
  }
  const antes = await getUsuario(email);
  await removerUsuario(email);
  await registrarPermissaoAudit({ alteradoPor: quemPediu, alvoEmail: email, acao: "remover", antes, depois: null });
  revalidatePath("/admin");
}
