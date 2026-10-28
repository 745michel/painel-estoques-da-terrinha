import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { headers } from "next/headers";
import { isDbConfigured } from "./app/lib/pg";
import { resolveAccess } from "./app/lib/access";
import { registrarLogin } from "./app/lib/audit";

/**
 * Login real via conta Microsoft/empresa (Entra ID) - substitui o header
 * "oai-authenticated-user-email" injetado pela plataforma Sites do ChatGPT, que só existe
 * quando publicado por lá. Sessao em JWT (sem banco) - quem pode ver o que é decidido
 * consultando a tabela "usuarios" no Postgres (app/lib/access.ts), não pelo token de login
 * em si.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [MicrosoftEntraID],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  events: {
    // Auditoria (28/10/2026): 1 linha por login de verdade (nao por carregamento de pagina -
    // force-dynamic re-roda em cada request, logar ali geraria uma linha por refresh). So
    // falhas de OAuth (senha errada, conta desativada no tenant) nunca chegam aqui - a
    // Microsoft barra antes, sem nos avisar. O que registramos e se o NOSSO painel autorizou
    // o acesso, nao se o login na Microsoft deu certo (isso so a Microsoft sabe).
    async signIn({ user }) {
      if (!isDbConfigured() || !user.email) return;
      try {
        const h = await headers();
        const encaminhado = h.get("x-forwarded-for");
        const ip = encaminhado ? encaminhado.split(",")[0]!.trim() : (h.get("x-real-ip") ?? null);
        const userAgent = h.get("user-agent");
        const { autorizado } = await resolveAccess(user.email);
        await registrarLogin({ email: user.email.trim().toLocaleLowerCase("pt-BR"), autorizado, ip, userAgent });
      } catch (error) {
        console.error("Falha ao gravar log de login:", error);
      }
    },
  },
});
