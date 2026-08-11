import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

/**
 * Login real via conta Microsoft/empresa (Entra ID) - substitui o header
 * "oai-authenticated-user-email" injetado pela plataforma Sites do ChatGPT, que só existe
 * quando publicado por lá. Sessao em JWT (sem banco) - quem pode ver o que é decidido a cada
 * requisicao consultando a lista SharePoint "AcessoPainelEstoques" (app/lib/sharepoint.ts),
 * não pelo token de login em si.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [MicrosoftEntraID],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
});
