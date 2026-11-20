import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, type SpaceSlug } from "../db/client.js";
import { itemsLinks, mails, spaces, tasks } from "../db/schema.js";
import { listMails, type Mail } from "./mails.js";
import { listOpenTasks, type Task } from "./tasks.js";

const RECENT_MS = 7 * 24 * 60 * 60_000;

export interface SpaceSummary {
  slug: SpaceSlug;
  name: string;
  color: string;
  openTasks: number;
  mails: number;
  importantMails: number;
}

/** Les cinq espaces avec ce qui les occupe : tâches à faire, mails non traités de la semaine. */
export async function spacesOverview(): Promise<SpaceSummary[]> {
  const [all, taskCounts, mailCounts] = await Promise.all([
    db.query.spaces.findMany({ orderBy: (s, { asc }) => asc(s.position) }),
    db
      .select({ spaceId: itemsLinks.spaceId, count: sql<number>`count(*)::int` })
      .from(itemsLinks)
      .innerJoin(tasks, eq(tasks.id, itemsLinks.itemId))
      .where(and(eq(itemsLinks.itemType, "task"), eq(tasks.status, "todo")))
      .groupBy(itemsLinks.spaceId),
    db
      .select({
        spaceId: itemsLinks.spaceId,
        count: sql<number>`count(*)::int`,
        important: sql<number>`count(*) filter (where ${mails.importance} = 'high')::int`,
      })
      .from(itemsLinks)
      .innerJoin(mails, eq(mails.id, itemsLinks.itemId))
      .where(
        and(
          eq(itemsLinks.itemType, "mail"),
          isNull(mails.handledAt),
          gte(mails.receivedAt, new Date(Date.now() - RECENT_MS)),
        ),
      )
      .groupBy(itemsLinks.spaceId),
  ]);
  return all.map((space) => {
    const t = taskCounts.find((c) => c.spaceId === space.id);
    const m = mailCounts.find((c) => c.spaceId === space.id);
    return {
      slug: space.slug as SpaceSlug,
      name: space.name,
      color: space.color,
      openTasks: t?.count ?? 0,
      mails: m?.count ?? 0,
      importantMails: m?.important ?? 0,
    };
  });
}

export interface SpaceLink {
  type: "task" | "mail";
  id: string;
  title: string;
  spaces: SpaceSlug[];
}

/** Éléments en cours rangés dans plusieurs espaces : Jarvis les signale comme liens. */
export async function spaceLinks(): Promise<SpaceLink[]> {
  const grouped = await db
    .select({
      itemType: itemsLinks.itemType,
      itemId: itemsLinks.itemId,
      slugs: sql<SpaceSlug[]>`array_agg(${spaces.slug} order by ${spaces.position})`,
    })
    .from(itemsLinks)
    .innerJoin(spaces, eq(spaces.id, itemsLinks.spaceId))
    .groupBy(itemsLinks.itemType, itemsLinks.itemId)
    .having(sql`count(*) >= 2`);

  const taskIds = grouped.filter((g) => g.itemType === "task").map((g) => g.itemId);
  const mailIds = grouped.filter((g) => g.itemType === "mail").map((g) => g.itemId);
  const [openTasks, openMails] = await Promise.all([
    taskIds.length === 0
      ? []
      : db
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(and(inArray(tasks.id, taskIds), eq(tasks.status, "todo"))),
    mailIds.length === 0
      ? []
      : db
          .select({ id: mails.id, title: sql<string>`coalesce(${mails.summary}, ${mails.subject})` })
          .from(mails)
          .where(
            and(
              inArray(mails.id, mailIds),
              isNull(mails.handledAt),
              gte(mails.receivedAt, new Date(Date.now() - RECENT_MS)),
            ),
          ),
  ]);

  const titles = new Map([...openTasks, ...openMails].map((r) => [r.id, r.title]));
  return grouped
    .filter((g) => titles.has(g.itemId))
    .map((g) => ({ type: g.itemType as SpaceLink["type"], id: g.itemId, title: titles.get(g.itemId)!, spaces: g.slugs }));
}

/** Tableau d'un espace : ses tâches à faire et ses mails de la semaine. */
export async function spaceBoard(slug: SpaceSlug): Promise<{ tasks: Task[]; mails: Mail[] }> {
  const [open, spaceMails] = await Promise.all([listOpenTasks(), listMails({ space: slug })]);
  return { tasks: open.filter((t) => t.spaces.includes(slug)), mails: spaceMails };
}
