import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { actionsLog } from "../db/schema.js";
import { rejectDraft, sendDraft } from "./mails.js";
import { cancelReminder } from "./reminders.js";
import { deleteTask, NotFoundError } from "./tasks.js";

export type Action = typeof actionsLog.$inferSelect;

/**
 * Actions qui exigent la validation de Jessim (cahier des charges, §10) :
 * elles sont mises en attente, et seul l'appel de confirmation les exécute.
 */
const VALIDATED_ACTIONS: Record<string, { confirm: (input: any) => Promise<void>; reject?: (input: any) => Promise<void> }> = {
  delete_task: { confirm: (input: { task_id: string }) => deleteTask(input.task_id) },
  cancel_reminder: {
    confirm: async (input: { reminder_id: string }) => {
      await cancelReminder(input.reminder_id);
    },
  },
  send_mail: {
    confirm: (input: { draft_id: string }) => sendDraft(input.draft_id),
    reject: (input: { draft_id: string }) => rejectDraft(input.draft_id),
  },
};

export async function logExecuted(tool: string, input: unknown, summary: string): Promise<void> {
  await db.insert(actionsLog).values({ tool, input, summary, status: "executed" });
}

export async function requestValidation(tool: string, input: unknown, summary: string): Promise<Action> {
  if (!VALIDATED_ACTIONS[tool]) throw new Error(`Action à valider inconnue : ${tool}`);
  const [row] = await db.insert(actionsLog).values({ tool, input, summary, status: "pending" }).returning();
  return row!;
}

/** Retire les actions en attente d'un outil dont l'entrée correspond (une proposition plus récente les remplace). */
export async function supersedePendingActions(tool: string, key: string, values: string[]): Promise<void> {
  if (values.length === 0) return;
  await db
    .update(actionsLog)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(
      and(
        eq(actionsLog.tool, tool),
        eq(actionsLog.status, "pending"),
        inArray(sql`${actionsLog.input} ->> ${key}`, values),
      ),
    );
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
  const handler = VALIDATED_ACTIONS[row.tool]!;
  try {
    if (decision === "confirmed") await handler.confirm(row.input);
    else await handler.reject?.(row.input);
  } catch (err) {
    // L'action n'a pas abouti (envoi refusé par Gmail...) : elle reste en attente, Jessim peut réessayer.
    await db.update(actionsLog).set({ status: "pending", resolvedAt: null }).where(eq(actionsLog.id, id));
    throw err;
  }
  return row;
}
