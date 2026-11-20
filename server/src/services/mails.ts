import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { config } from "../config.js";
import { fetchGmailSince, isGmailConfigured, sendGmailReply } from "../connectors/google/gmail.js";
import type { FetchedMail, ReplyTarget } from "../connectors/mail/types.js";
import {
  fetchOutlookSince,
  isOutlookConfigured,
  sendOutlookReply,
  type TokenStore,
} from "../connectors/microsoft/outlook.js";
import { isNotifyConfigured, sendNotification } from "../connectors/notifications/ntfy.js";
import { db, type SpaceSlug } from "../db/client.js";
import { itemsLinks, mailDrafts, mails, spaces, type MailProvider } from "../db/schema.js";
import { requestValidation, supersedePendingActions } from "./actions.js";
import { getValue, setValue } from "./kv.js";
import { setItemSpaces, spacesOf } from "./links.js";
import { NotFoundError } from "./tasks.js";
import { triageMail } from "./triage.js";

export type Mail = typeof mails.$inferSelect & { spaces: SpaceSlug[] };

/**
 * Le refresh token Microsoft change à chaque renouvellement : on garde le dernier en base.
 * Si MS_REFRESH_TOKEN change dans le .env (nouvelle connexion), c'est lui qui reprend la main.
 */
const msTokenStore: TokenStore = {
  async load() {
    const stored = await getValue("ms_refresh_token");
    if (!stored) return null;
    const { envHash, token } = JSON.parse(stored) as { envHash: string; token: string };
    return envHash === hash(config.MS_REFRESH_TOKEN) ? token : null;
  },
  async save(token) {
    await setValue("ms_refresh_token", JSON.stringify({ envHash: hash(config.MS_REFRESH_TOKEN), token }));
  },
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const PROVIDERS: Record<
  MailProvider,
  {
    configured: () => boolean;
    fetch: (since: Date) => Promise<FetchedMail[]>;
    reply: (target: ReplyTarget, body: string) => Promise<void>;
  }
> = {
  gmail: { configured: isGmailConfigured, fetch: fetchGmailSince, reply: sendGmailReply },
  outlook: {
    configured: isOutlookConfigured,
    fetch: (since) => fetchOutlookSince(msTokenStore, since),
    reply: (target, body) => sendOutlookReply(msTokenStore, target, body),
  },
};

export function mailStatus(): Record<MailProvider, "configured" | "not_configured"> {
  return {
    gmail: isGmailConfigured() ? "configured" : "not_configured",
    outlook: isOutlookConfigured() ? "configured" : "not_configured",
  };
}

export function anyMailboxConfigured(): boolean {
  return Object.values(PROVIDERS).some((p) => p.configured());
}

/** À la première relève, on remonte deux jours en arrière. */
const FIRST_SYNC_MS = 2 * 24 * 60 * 60_000;
/** Chevauchement entre deux relèves, pour ne rien rater ; les doublons sont ignorés. */
const OVERLAP_MS = 10 * 60_000;

/** Relève les boîtes configurées. Renvoie le nombre de nouveaux mails. */
export async function syncMails(): Promise<number> {
  let added = 0;
  for (const [provider, p] of Object.entries(PROVIDERS) as [MailProvider, (typeof PROVIDERS)[MailProvider]][]) {
    if (!p.configured()) continue;
    const startedAt = new Date();
    const last = await getValue(`mail_sync:${provider}`);
    const since = last ? new Date(new Date(last).getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_SYNC_MS);
    const fetched = await p.fetch(since);
    if (fetched.length > 0) {
      const inserted = await db
        .insert(mails)
        .values(fetched.map((m) => ({ ...m, provider })))
        .onConflictDoNothing({ target: [mails.provider, mails.externalId] })
        .returning({ id: mails.id });
      added += inserted.length;
    }
    await setValue(`mail_sync:${provider}`, startedAt.toISOString());
  }
  return added;
}

/** Relève, tri et notification des mails importants, en un passage. */
let checking: Promise<{ added: number }> | null = null;
export function checkMailboxes(): Promise<{ added: number }> {
  // Un passage déjà en cours (planificateur ou bouton « Relever ») est partagé, jamais doublé.
  checking ??= (async () => {
    if (!anyMailboxConfigured()) return { added: 0 };
    const added = await syncMails();
    if (added > 0) console.log(`${added} nouveau(x) mail(s) relevé(s).`);
    await triagePendingMails();
    await notifyImportantMails();
    return { added };
  })().finally(() => {
    checking = null;
  });
  return checking;
}

const MAX_TRIAGE_ATTEMPTS = 3;

/** Trie les mails pas encore triés. Sans Claude, un tri de secours est appliqué après trois échecs. */
export async function triagePendingMails(): Promise<void> {
  const pending = await db
    .select()
    .from(mails)
    .where(
      and(
        isNull(mails.importance),
        lt(mails.triageAttempts, MAX_TRIAGE_ATTEMPTS),
        gte(mails.receivedAt, new Date(Date.now() - 14 * 24 * 60 * 60_000)),
      ),
    )
    .orderBy(desc(mails.receivedAt))
    .limit(30);

  for (const mail of pending) {
    let result: Awaited<ReturnType<typeof triageMail>> = null;
    let failed = false;
    try {
      result = await triageMail(mail);
    } catch (err) {
      failed = true;
      console.error(`Tri du mail « ${mail.subject} » impossible :`, err);
    }

    if (result) {
      await db
        .update(mails)
        .set({
          importance: result.importance,
          summary: result.summary,
          needsReply: result.needsReply,
          schoolEvent: result.schoolEvent,
          triageSource: "claude",
        })
        .where(eq(mails.id, mail.id));
      await setItemSpaces("mail", mail.id, result.spaces);
      continue;
    }

    const attempts = mail.triageAttempts + 1;
    if (failed && attempts < MAX_TRIAGE_ATTEMPTS) {
      await db.update(mails).set({ triageAttempts: attempts }).where(eq(mails.id, mail.id));
      continue;
    }
    // Refus, ou trois échecs : tri de secours, sans IA.
    await db
      .update(mails)
      .set({ importance: "normal", summary: mail.subject, triageSource: "fallback", triageAttempts: attempts })
      .where(eq(mails.id, mail.id));
    await setItemSpaces("mail", mail.id, mail.provider === "outlook" ? ["ecole"] : []);
  }
}

/** Une seule notification pour les nouveaux mails importants des dernières 24 heures. */
export async function notifyImportantMails(): Promise<void> {
  if (!isNotifyConfigured()) return;
  const fresh = await db
    .select()
    .from(mails)
    .where(
      and(
        eq(mails.importance, "high"),
        isNull(mails.handledAt),
        isNull(mails.notifiedAt),
        gte(mails.receivedAt, new Date(Date.now() - 24 * 60 * 60_000)),
      ),
    )
    .orderBy(desc(mails.receivedAt));
  if (fresh.length === 0) return;
  await sendNotification({
    title: fresh.length === 1 ? "Mail important" : `${fresh.length} mails importants`,
    message: fresh.map((m) => `${m.fromName} : ${m.summary ?? m.subject}`).join("\n"),
    priority: 4,
    tags: ["envelope"],
  });
  await db
    .update(mails)
    .set({ notifiedAt: new Date() })
    .where(inArray(mails.id, fresh.map((m) => m.id)));
}

async function withSpaces(rows: (typeof mails.$inferSelect)[]): Promise<Mail[]> {
  const links = await spacesOf("mail", rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, spaces: links.get(row.id) ?? [] }));
}

export interface MailFilter {
  space?: SpaceSlug;
  importantOnly?: boolean;
  includeHandled?: boolean;
  days?: number;
  limit?: number;
}

/** Mails triés, du plus récent au plus ancien. */
export async function listMails(filter: MailFilter = {}): Promise<Mail[]> {
  const conditions = [gte(mails.receivedAt, new Date(Date.now() - (filter.days ?? 7) * 24 * 60 * 60_000))];
  if (filter.importantOnly) conditions.push(eq(mails.importance, "high"));
  if (!filter.includeHandled) conditions.push(isNull(mails.handledAt));
  if (filter.space) {
    const linked = db
      .select({ id: itemsLinks.itemId })
      .from(itemsLinks)
      .innerJoin(spaces, eq(spaces.id, itemsLinks.spaceId))
      .where(and(eq(itemsLinks.itemType, "mail"), eq(spaces.slug, filter.space)));
    conditions.push(inArray(mails.id, linked));
  }
  const rows = await db
    .select()
    .from(mails)
    .where(and(...conditions))
    .orderBy(desc(mails.receivedAt))
    .limit(filter.limit ?? 30);
  return withSpaces(rows);
}

export async function getMail(id: string): Promise<Mail> {
  const row = await db.query.mails.findFirst({ where: eq(mails.id, id) });
  if (!row) throw new NotFoundError(`Aucun mail avec l'identifiant ${id}.`);
  const [mail] = await withSpaces([row]);
  return mail!;
}

export async function setMailHandled(id: string, handled: boolean): Promise<Mail> {
  await getMail(id);
  await db.update(mails).set({ handledAt: handled ? new Date() : null }).where(eq(mails.id, id));
  return getMail(id);
}

/** Prépare une réponse et la met en attente : rien ne part sans la validation de Jessim. */
export async function proposeReply(mailId: string, body: string): Promise<void> {
  const mail = await getMail(mailId);
  if (!PROVIDERS[mail.provider].configured()) {
    throw new Error("Cette boîte mail n'est plus connectée : la réponse ne pourrait pas partir.");
  }
  // Une nouvelle proposition remplace la précédente : jamais deux réponses en attente pour le même mail.
  const previous = await db
    .update(mailDrafts)
    .set({ status: "rejected" })
    .where(and(eq(mailDrafts.mailId, mailId), eq(mailDrafts.status, "pending")))
    .returning({ id: mailDrafts.id });
  await supersedePendingActions("send_mail", "draft_id", previous.map((d) => d.id));

  const [draft] = await db.insert(mailDrafts).values({ mailId, body }).returning();
  await requestValidation(
    "send_mail",
    { draft_id: draft!.id },
    `Répondre à ${mail.fromName} (« ${mail.subject} ») :\n\n${body}`,
  );
}

export async function sendDraft(draftId: string): Promise<void> {
  const draft = await db.query.mailDrafts.findFirst({ where: eq(mailDrafts.id, draftId) });
  if (!draft) throw new NotFoundError("Brouillon introuvable.");
  if (draft.status !== "pending") throw new Error("Ce brouillon a déjà été envoyé ou refusé.");
  const mail = await getMail(draft.mailId);
  await PROVIDERS[mail.provider].reply(mail, draft.body);
  await db.update(mailDrafts).set({ status: "sent", sentAt: new Date() }).where(eq(mailDrafts.id, draftId));
  await db.update(mails).set({ handledAt: new Date() }).where(eq(mails.id, mail.id));
}

export async function rejectDraft(draftId: string): Promise<void> {
  await db.update(mailDrafts).set({ status: "rejected" }).where(eq(mailDrafts.id, draftId));
}
