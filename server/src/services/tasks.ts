import { and, eq, inArray } from "drizzle-orm";
import { db, type SpaceSlug } from "../db/client.js";
import { itemsLinks, spaces, tasks, type Priority } from "../db/schema.js";
import { orderTasks } from "../planner/schedule.js";

export type Task = typeof tasks.$inferSelect & { spaces: SpaceSlug[] };

export class NotFoundError extends Error {}

async function withSpaces(rows: (typeof tasks.$inferSelect)[]): Promise<Task[]> {
  if (rows.length === 0) return [];
  const links = await db
    .select({ itemId: itemsLinks.itemId, slug: spaces.slug })
    .from(itemsLinks)
    .innerJoin(spaces, eq(spaces.id, itemsLinks.spaceId))
    .where(and(eq(itemsLinks.itemType, "task"), inArray(itemsLinks.itemId, rows.map((r) => r.id))));
  return rows.map((row) => ({
    ...row,
    spaces: links.filter((l) => l.itemId === row.id).map((l) => l.slug as SpaceSlug),
  }));
}

/** Tâches à faire, dans l'ordre où Jarvis les traite. */
export async function listOpenTasks(): Promise<Task[]> {
  const rows = await db.select().from(tasks).where(eq(tasks.status, "todo"));
  return orderTasks(await withSpaces(rows));
}

export async function listDoneTasks(limit = 20): Promise<Task[]> {
  const rows = await db.query.tasks.findMany({
    where: eq(tasks.status, "done"),
    orderBy: (t, { desc }) => desc(t.completedAt),
    limit,
  });
  return withSpaces(rows);
}

export async function getTask(id: string): Promise<Task> {
  const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!row) throw new NotFoundError(`Aucune tâche avec l'identifiant ${id}.`);
  const [task] = await withSpaces([row]);
  return task!;
}

async function setSpaces(taskId: string, slugs: SpaceSlug[]): Promise<void> {
  await db.delete(itemsLinks).where(and(eq(itemsLinks.itemType, "task"), eq(itemsLinks.itemId, taskId)));
  if (slugs.length === 0) return;
  const rows = await db.select().from(spaces).where(inArray(spaces.slug, slugs));
  await db.insert(itemsLinks).values(rows.map((s) => ({ itemType: "task", itemId: taskId, spaceId: s.id })));
}

export interface TaskInput {
  title: string;
  durationMin?: number;
  priority?: Priority;
  deadline?: Date | null;
  spaces?: SpaceSlug[];
}

export async function createTask(input: TaskInput): Promise<Task> {
  const { spaces: slugs, ...values } = input;
  const [row] = await db.insert(tasks).values(values).returning();
  await setSpaces(row!.id, slugs ?? []);
  return getTask(row!.id);
}

export async function updateTask(id: string, input: Partial<TaskInput>): Promise<Task> {
  const { spaces: slugs, ...values } = input;
  await getTask(id);
  if (Object.keys(values).length > 0) await db.update(tasks).set(values).where(eq(tasks.id, id));
  if (slugs) await setSpaces(id, slugs);
  return getTask(id);
}

export async function completeTask(id: string, actualMin?: number): Promise<Task> {
  await getTask(id);
  await db
    .update(tasks)
    .set({ status: "done", completedAt: new Date(), actualMin: actualMin ?? null, beforeTaskId: null })
    .where(eq(tasks.id, id));
  return getTask(id);
}

export async function reopenTask(id: string): Promise<Task> {
  await getTask(id);
  await db.update(tasks).set({ status: "todo", completedAt: null, actualMin: null }).where(eq(tasks.id, id));
  return getTask(id);
}

/** « id passe avant beforeId ». */
export async function prioritizeTask(id: string, beforeId: string): Promise<void> {
  if (id === beforeId) throw new Error("Une tâche ne peut pas passer avant elle-même.");
  const [, other] = await Promise.all([getTask(id), getTask(beforeId)]);
  // La consigne la plus récente gagne si elle contredit l'ancienne.
  if (other.beforeTaskId === id) await db.update(tasks).set({ beforeTaskId: null }).where(eq(tasks.id, beforeId));
  await db.update(tasks).set({ beforeTaskId: beforeId }).where(eq(tasks.id, id));
}

export async function deleteTask(id: string): Promise<void> {
  await getTask(id);
  await db.update(tasks).set({ beforeTaskId: null }).where(eq(tasks.beforeTaskId, id));
  await db.delete(itemsLinks).where(and(eq(itemsLinks.itemType, "task"), eq(itemsLinks.itemId, id)));
  await db.delete(tasks).where(eq(tasks.id, id));
}
