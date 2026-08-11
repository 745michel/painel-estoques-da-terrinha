import { NextResponse, type NextRequest } from "next/server";

/**
 * Barreira simples (HTTP Basic Auth) para manter o painel fora do alcance de robos e
 * curiosos enquanto o login real (Microsoft/Entra ID, ver auth.ts) fica pendente da URL de
 * redirecionamento do TI. So ativa se BASIC_AUTH_PASSWORD estiver configurado - em dev local
 * sem essa env var, nao faz nada. Ver CLAUDE.md, 11/08/2026.
 *
 * Chama-se "proxy.ts" (nao "middleware.ts") porque o Next.js 16/vinext descontinuou o nome
 * antigo.
 */
export default function proxy(request: NextRequest) {
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!password) return NextResponse.next();

  const user = process.env.BASIC_AUTH_USER ?? "daterrinha";
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice(6));
    const [sentUser, sentPassword] = decoded.split(":");
    if (sentUser === user && sentPassword === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Autenticação necessária.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Painel Da Terrinha"' },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
