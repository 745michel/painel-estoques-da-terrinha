// Busca os JSON do painel direto do SharePoint (biblioteca DT-BI / extracao_dados_planejamento_estoque)
// via Microsoft Graph, em tempo de execucao - nao ficam presos ao build.
//
// Requer credencial de aplicativo (Entra ID) com permissao Application "Sites.Selected",
// concedida apenas ao site DT-BI (least privilege). Variaveis de ambiente necessarias:
//   SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET,
//   SHAREPOINT_SITE_HOSTNAME (ex: daterrinhaalimentoscombr.sharepoint.com),
//   SHAREPOINT_SITE_PATH (ex: /sites/DT-BI),
//   SHAREPOINT_FOLDER_PATH (ex: /Documentos Compartilhados/pcp/extracao_dados_planejamento_estoque)
//
// Enquanto essas variaveis nao existirem, isConfigured() retorna false e quem chamar deve
// usar o fallback local (ver app/page.tsx).

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedSiteId: string | null = null;

export function isConfigured(): boolean {
  return Boolean(
    process.env.SHAREPOINT_TENANT_ID &&
      process.env.SHAREPOINT_CLIENT_ID &&
      process.env.SHAREPOINT_CLIENT_SECRET &&
      process.env.SHAREPOINT_SITE_HOSTNAME &&
      process.env.SHAREPOINT_SITE_PATH,
  );
}

async function getAppOnlyToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const tenantId = process.env.SHAREPOINT_TENANT_ID!;
  const clientId = process.env.SHAREPOINT_CLIENT_ID!;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET!;

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!response.ok) {
    throw new Error(`Falha ao obter token do Graph (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

async function getSiteId(token: string): Promise<string> {
  if (cachedSiteId) return cachedSiteId;
  const hostname = process.env.SHAREPOINT_SITE_HOSTNAME!;
  const sitePath = process.env.SHAREPOINT_SITE_PATH!;
  const response = await fetch(`https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Falha ao resolver o site do SharePoint (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { id: string };
  cachedSiteId = data.id;
  return data.id;
}

/** Busca e faz parse de um arquivo JSON da pasta configurada, direto do SharePoint. */
export async function fetchSharePointJson<T>(fileName: string): Promise<T> {
  const token = await getAppOnlyToken();
  const siteId = await getSiteId(token);
  const folderPath = process.env.SHAREPOINT_FOLDER_PATH ?? "";
  const filePath = `${folderPath}/${fileName}`.replace(/\/+/g, "/");
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:${encodeURI(filePath)}:/content`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Falha ao baixar ${fileName} do SharePoint (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export type AccessEntry = {
  email: string;
  nome: string | null;
  acessoValores: boolean;
  ativo: boolean;
};

type SharePointListItem = {
  fields: {
    Email?: string;
    Nome?: string;
    AcessoValores?: boolean;
    Ativo?: boolean;
  };
};

/**
 * Le a lista "AcessoPainelEstoques" no SharePoint (gerenciada direto pelo usuario, sem tela
 * de admin dentro do painel). Uma linha por pessoa autorizada a fazer login. Ver CLAUDE.md.
 */
export async function fetchAccessList(): Promise<AccessEntry[]> {
  const token = await getAppOnlyToken();
  const siteId = await getSiteId(token);
  const listName = process.env.SHAREPOINT_ACCESS_LIST_NAME ?? "AcessoPainelEstoques";
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${encodeURIComponent(listName)}/items?expand=fields&$top=999`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Falha ao ler a lista ${listName} do SharePoint (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { value: SharePointListItem[] };
  return data.value
    .filter((item) => item.fields.Email)
    .map((item) => ({
      email: item.fields.Email!.trim().toLocaleLowerCase("pt-BR"),
      nome: item.fields.Nome ?? null,
      acessoValores: item.fields.AcessoValores ?? false,
      ativo: item.fields.Ativo ?? true,
    }));
}
