import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { getUsuario, listarUsuarios } from "../lib/access";
import { isDbConfigured } from "../lib/pg";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLocaleLowerCase("pt-BR");
  if (!email) {
    redirect("/login");
  }
  if (!isDbConfigured()) {
    return (
      <main style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
        <h1>Administração indisponível</h1>
        <p>O banco de dados não está configurado nesta hospedagem.</p>
      </main>
    );
  }
  const usuario = await getUsuario(email!);
  if (!usuario?.admin) {
    return (
      <main style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
        <h1>Acesso restrito</h1>
        <p>Sua conta não tem permissão de administrador.</p>
        <a href="/">← Voltar pro painel</a>
      </main>
    );
  }
  const usuarios = await listarUsuarios();
  return <AdminClient usuarios={usuarios} meuEmail={email!} />;
}
