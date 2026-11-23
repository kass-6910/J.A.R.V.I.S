import { config } from "../../config.js";
import { cleanBody, htmlToText } from "../mail/mime.js";
import type { FetchedMail, ReplyTarget } from "../mail/types.js";
import { MS_SCOPES } from "./scopes.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Où ranger le refresh token : Microsoft en renvoie un nouveau à chaque renouvellement. */
export interface TokenStore {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
}

export function isOutlookConfigured(): boolean {
  return Boolean(config.MS_CLIENT_ID && config.MS_REFRESH_TOKEN);
}

let accessToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(store: TokenStore): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const refreshToken = (await store.load()) ?? config.MS_REFRESH_TOKEN;
  const res = await fetch(`https://login.microsoftonline.com/${config.MS_TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.MS_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MS_SCOPES.join(" "),
    }),
  });
  if (!res.ok) throw new Error(`Microsoft a refusé le jeton (${res.status}) : ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  if (body.refresh_token && body.refresh_token !== refreshToken) await store.save(body.refresh_token);
  accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return accessToken.value;
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string | null;
  bodyPreview?: string;
  body?: { contentType: "text" | "html"; content: string };
  from?: { emailAddress: { name?: string; address?: string } };
  replyTo?: { emailAddress: { name?: string; address?: string } }[];
  receivedDateTime: string;
  isRead?: boolean;
}

/** Message Graph vers le format commun. Pure : testée à part. */
export function parseGraphMessage(message: GraphMessage): FetchedMail {
  const fromAddress = message.from?.emailAddress.address ?? "";
  const content = message.body?.content ?? "";
  return {
    externalId: message.id,
    threadId: message.conversationId ?? null,
    messageIdHeader: message.internetMessageId ?? null,
    fromName: message.from?.emailAddress.name || fromAddress,
    fromAddress,
    replyAddress: message.replyTo?.[0]?.emailAddress.address ?? fromAddress,
    subject: message.subject?.trim() || "(sans objet)",
    snippet: message.bodyPreview ?? "",
    body: cleanBody(message.body?.contentType === "html" ? htmlToText(content) : content),
    receivedAt: new Date(message.receivedDateTime),
    unread: message.isRead === false,
  };
}

async function graph<T>(store: TokenStore, url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getAccessToken(store)}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.body-content-type="text"',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Microsoft Graph a répondu ${res.status} : ${await res.text()}`);
  return res.status === 202 || res.status === 204 ? null : ((await res.json()) as T);
}

/** Mails de la boîte de réception reçus depuis « since » (200 au plus). */
export async function fetchOutlookSince(store: TokenStore, since: Date): Promise<FetchedMail[]> {
  const params = new URLSearchParams({
    $filter: `receivedDateTime ge ${since.toISOString()}`,
    $orderby: "receivedDateTime desc",
    $top: "50",
    $select: "id,conversationId,internetMessageId,subject,bodyPreview,body,from,replyTo,receivedDateTime,isRead",
  });
  const mails: FetchedMail[] = [];
  let next: string | undefined = `/me/mailFolders/inbox/messages?${params}`;
  while (next && mails.length < 200) {
    const page: { value: GraphMessage[]; "@odata.nextLink"?: string } | null = await graph(store, next);
    mails.push(...(page?.value ?? []).map(parseGraphMessage));
    next = page?.["@odata.nextLink"];
  }
  return mails;
}

/** Répond dans le fil d'origine : Outlook garde l'objet et l'historique. */
export async function sendOutlookReply(store: TokenStore, target: ReplyTarget, body: string): Promise<void> {
  await graph(store, `/me/messages/${encodeURIComponent(target.externalId)}/reply`, {
    method: "POST",
    body: JSON.stringify({ comment: body }),
  });
}
