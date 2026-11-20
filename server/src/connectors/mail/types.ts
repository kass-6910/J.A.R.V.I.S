/** Mail tel que les connecteurs le rendent, quelle que soit la boîte d'origine. */
export interface FetchedMail {
  externalId: string;
  threadId: string | null;
  messageIdHeader: string | null;
  fromName: string;
  fromAddress: string;
  replyAddress: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
  unread: boolean;
}

export interface ReplyTarget {
  externalId: string;
  threadId: string | null;
  messageIdHeader: string | null;
  replyAddress: string;
  subject: string;
}
