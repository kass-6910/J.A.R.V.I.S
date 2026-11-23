import { config } from "../../config.js";
import { buildReplyMime, cleanBody, decodeBase64Url, encodeBase64Url, htmlToText, parseAddress } from "../mail/mime.js";
import type { FetchedMail, ReplyTarget } from "../mail/types.js";
import { getAccessToken, isGoogleConfigured } from "./oauth.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Gmail demande en plus d'avoir autorisé les droits Gmail (GMAIL_ENABLED=true après l'autorisation). */
export function isGmailConfigured(): boolean {
  return isGoogleConfigured() && config.GMAIL_ENABLED;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate: string;
  payload: GmailPart;
}

function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

/** Message Gmail (format « full ») vers le format commun. Pure : testée à part. */
export function parseGmailMessage(message: GmailMessage): FetchedMail {
  const headers = new Map(
    (message.payload.headers ?? []).map((h) => [h.name.toLowerCase(), h.value] as const),
  );
  const from = parseAddress(headers.get("from") ?? "");
  const replyTo = headers.get("reply-to");

  const plain = findPart(message.payload, "text/plain");
  const html = findPart(message.payload, "text/html");
  const raw = plain ? decodeBase64Url(plain.body!.data!) : html ? htmlToText(decodeBase64Url(html.body!.data!)) : "";

  return {
    externalId: message.id,
    threadId: message.threadId,
    messageIdHeader: headers.get("message-id") ?? null,
    fromName: from.name,
    fromAddress: from.address,
    replyAddress: replyTo ? parseAddress(replyTo).address : from.address,
    subject: headers.get("subject")?.trim() || "(sans objet)",
    snippet: message.snippet ?? "",
    body: cleanBody(raw),
    receivedAt: new Date(Number(message.internalDate)),
    unread: message.labelIds?.includes("UNREAD") ?? false,
  };
}

async function gmail<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gmail a répondu ${res.status} : ${await res.text()}`);
  return (await res.json()) as T;
}

/** Mails de la boîte de réception reçus depuis « since » (200 au plus). */
export async function fetchGmailSince(since: Date): Promise<FetchedMail[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `in:inbox after:${Math.floor(since.getTime() / 1000)}`,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${params}`);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < 200);

  const mails: FetchedMail[] = [];
  for (const id of ids) mails.push(parseGmailMessage(await gmail<GmailMessage>(`/messages/${id}?format=full`)));
  return mails;
}

export async function sendGmailReply(target: ReplyTarget, body: string): Promise<void> {
  const raw = encodeBase64Url(
    buildReplyMime({ to: target.replyAddress, subject: target.subject, body, inReplyTo: target.messageIdHeader }),
  );
  await gmail("/messages/send", { method: "POST", body: JSON.stringify({ raw, threadId: target.threadId }) });
}
