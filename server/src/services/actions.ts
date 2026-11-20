import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { actionsLog } from "../db/schema.js";
import { deleteTask, NotFoundError } from "./tasks.js";

export type Action = typeof actionsLog.$inferSelect;

/**
 * Actions qui exigent la validation de Jessim (cahier des charges, §10) :
 * elles sont mises en attente, et seul l'appel de confirmation les exécute.
 */
const VALIDATED_ACTIONS: Record<string, (input: any) => Promise<void>> = {
  delete_task: (input: { task_id: string }) => deleteTask(input.task_id),
};

export async function logExecuted(tool: string, input: unknown, summary: string): Promise<void> {
  await db.insert(actionsLog).values({ tool, input, summary, status: "executed" });
}

export async function requestValidation(tool: string, input: unknown, summary: string): Promise<Action> {
  if (!VALIDATED_ACTIONS[tool]) throw new Error(`Action à valider inconnue : ${tool}`);
  const [row] = await db.insert(actionsLog).values({ tool, input, summary, status: "pending" }).returning();
  return row!;
}

export async function listPendingActions(): Promise<Action[]> {
  return db.query.actionsLog.findMany({
    where: eq(actionsLog.status, "pending"),
    orderBy: (a, { asc }) => asc(a.createdAt),
  });
}

export async function resolveAction(id: string, decision: "confirmed" | "rejected"): Promise<Action> {
  // Le passage de « pending » à l'état final est atomique : une action ne s'exécute qu'une fois.
  const [row] = await db
    .update(actionsLog)
    .set({ status: decision, resolvedAt: new Date() })
    .where(and(eq(actionsLog.id, id), eq(actionsLog.status, "pending")))
    .returning();
  if (!row) throw new NotFoundError("Aucune action en attente avec cet identifiant.");
  if (decision === "confirmed") await VALIDATED_ACTIONS[row.tool]!(row.input);
  return row;
}
